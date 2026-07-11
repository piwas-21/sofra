/**
 * Hardened JSON-LD renderer shared by all structured-data emitters. Content is
 * static strings from the messages files — no user input reaches these script
 * tags; "<" is escaped so no value can ever close the tag (standard Next.js
 * JSON-LD hardening).
 */
export default function JsonLdScript({ data }: Readonly<{ data: object[] }>) {
  return (
    <>
      {data
        .map((entry) => JSON.stringify(entry).replaceAll("<", String.raw`\u003c`))
        .map((json) => (
          <script
            key={json}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: json }}
          />
        ))}
    </>
  );
}
