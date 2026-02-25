import { getSupabaseServerAuthClient, getSupabaseServerClient } from "@/utils/supabaseServer";
import { PORTAL_ACCOUNT_SELECT_COLUMNS, asText, asUuid, mapPortalAccountRow } from "@/utils/crmPortal";

type PortalAuthError = {
  status: number;
  error: string;
  details?: string;
};

export type PortalRequestContext = {
  auth_user_id: string;
  access_token: string;
  organization_id: string;
  portal_account: ReturnType<typeof mapPortalAccountRow>;
};

type ResolvePortalRequestContextOptions = {
  organizationIdHint?: string | null;
  allowInactive?: boolean;
};

const getBearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization");
  const value = asText(authorization);
  if (!value) return null;

  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer") return null;
  return asText(token);
};

const toPortalAuthError = (status: number, error: string, details?: string): PortalAuthError => ({
  status,
  error,
  details,
});

export const resolvePortalRequestContext = async (
  request: Request,
  options: ResolvePortalRequestContextOptions = {}
): Promise<{ data: PortalRequestContext | null; error: PortalAuthError | null }> => {
  const token = getBearerToken(request);
  if (!token) {
    return {
      data: null,
      error: toPortalAuthError(401, "auth_token_required"),
    };
  }

  const authClient = getSupabaseServerAuthClient();
  if (!authClient) {
    return {
      data: null,
      error: toPortalAuthError(500, "supabase_auth_not_configured"),
    };
  }

  const serviceClient = getSupabaseServerClient();
  if (!serviceClient) {
    return {
      data: null,
      error: toPortalAuthError(500, "supabase_not_configured"),
    };
  }

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      data: null,
      error: toPortalAuthError(401, "invalid_auth_token", authError?.message),
    };
  }

  const authUserId = asUuid(authData.user.id);
  if (!authUserId) {
    return {
      data: null,
      error: toPortalAuthError(401, "invalid_auth_user_id"),
    };
  }

  let accountQuery = serviceClient
    .schema("crm")
    .from("portal_accounts")
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .eq("auth_user_id", authUserId)
    .order("created_at", { ascending: true });

  const orgHint = asUuid(options.organizationIdHint);
  if (orgHint) {
    accountQuery = accountQuery.eq("organization_id", orgHint);
  }

  const { data: accountRows, error: accountError } = await accountQuery;
  if (accountError) {
    return {
      data: null,
      error: toPortalAuthError(500, "db_portal_account_read_error", accountError.message),
    };
  }

  const accounts = (accountRows ?? []).map((row) => mapPortalAccountRow(row as Record<string, unknown>));
  if (!accounts.length) {
    return {
      data: null,
      error: toPortalAuthError(403, "portal_account_not_found"),
    };
  }

  const activeAccount = accounts.find((entry) => entry.status === "active");
  const portalAccount = activeAccount ?? accounts[0];

  if (!options.allowInactive && portalAccount.status !== "active") {
    return {
      data: null,
      error: toPortalAuthError(403, "portal_account_not_active"),
    };
  }

  const organizationId = asUuid(portalAccount.organization_id);
  if (!organizationId) {
    return {
      data: null,
      error: toPortalAuthError(500, "portal_account_organization_id_missing"),
    };
  }

  return {
    data: {
      auth_user_id: authUserId,
      access_token: token,
      organization_id: organizationId,
      portal_account: portalAccount,
    },
    error: null,
  };
};
