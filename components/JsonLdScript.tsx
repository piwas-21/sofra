/**
 * Hardened JSON-LD renderer shared by all structured-data emitters. Content is
 * static strings from the messages files — no user input reaches these script
 * tags; "<" is escaped so no value can ever close the tag (standard Next.js
 * JSON-LD hardening).
 */
export default function JsonLdScript({ data }: { data: object[] }) {
  return (
    <>
      {data.map((entry, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(entry).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
