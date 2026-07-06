// Fixture for the write-back test. Deliberately covers every case the real engine must face:
//   - plain JSX text (h1, h2)            -> editable
//   - string-literal JSX expression      -> editable
//   - text interleaved with inline markup (<code>, <strong>) -> per-segment editable
//   - a DUPLICATE phrase on two lines    -> must be disambiguated by location
//   - dynamic text {props.title}, {t(k)} -> must NOT be matched (honest ceiling)

export function Sample({ title, t }: { title: string; t: (k: string) => string }) {
  return (
    <main>
      <h1>The moment of choice is the only part that needed you.</h1>
      <h2>{"What you see is what you ship"}</h2>
      <p>
        A page set in <code>Inter</code> reads as competent and{" "}
        <strong>anonymous</strong> in the same breath.
      </p>
      <p>Good design is the presence of a decision.</p>
      <p>Good design is the presence of a decision.</p>
      <p>{title}</p>
      <p>{t("hero.subtitle")}</p>
    </main>
  );
}
