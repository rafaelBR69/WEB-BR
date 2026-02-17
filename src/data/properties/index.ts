type PropertyRecord = {
  id?: string | number;
  [key: string]: unknown;
};

const modules = import.meta.glob("./*.json", { eager: true });

const properties = Object.values(modules)
  .map((mod) => (mod as { default?: PropertyRecord }).default)
  .filter((item): item is PropertyRecord => Boolean(item))
  .sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

export default properties;

