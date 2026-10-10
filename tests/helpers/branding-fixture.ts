/** Reserved test contacts; never production configuration. */
export function fixtureUrl(label: string): string {
  const url = new URL("https:" + "//" + [label, "example", "test"].join("."));
  return url.origin;
}
export function fixtureEmail(local: string, label: string): string {
  return [local, [label, "example", "test"].join(".")].join("@");
}
export const platformFixture = { name: "Sofra", url: fixtureUrl("platform"), email: fixtureEmail("hello", "platform") };
