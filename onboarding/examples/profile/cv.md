<!--
  cv.md — GOLDEN ONBOARDING EXAMPLE (Sam Rivera). Master CV: the single source
  of truth for resume CONTENT. The tailor may select and reorder from this but
  never invents beyond it. Numbers here stay consistent with article-digest.md.
  Everything below is fictional.
-->

# Sam Rivera — Master CV

**Email:** sam.rivera@example.com
**Phone:** +1-555-0179
**Location:** Austin, TX
**LinkedIn:** linkedin.com/in/samrivera-example
**GitHub:** github.com/samrivera-example
**Website:** samrivera.example.dev

## Summary

Frontend engineer (~7 years) specializing in design systems and accessibility.
Builds component libraries, design tokens, and the tooling and docs that drive
adoption across product teams. Treats accessibility as a correctness property.

## Technical Skills

- **Languages:** TypeScript, JavaScript (ES2020+), HTML, CSS
- **UI:** React, design systems, component-library architecture, Storybook
- **Styling:** design tokens, theming, CSS Modules, Tailwind, CSS-in-JS
- **Accessibility:** WCAG 2.1/2.2, ARIA, keyboard + screen-reader support,
  axe-core
- **Testing:** Jest, React Testing Library, Playwright, visual regression
- **Tooling:** Vite, Webpack, Turborepo monorepos, GitHub Actions CI

## Experience

### Lumen Labs — Senior Frontend Engineer, Design Systems
*Remote (Austin, TX) · February 2021 – Present*

- Built and maintained the company's React component library, adopted by 9
  product teams and cutting net-new UI code roughly 30% across them.
- Designed a design-token pipeline (Figma → JSON → themed CSS variables)
  supporting light/dark and three brand themes from one source of truth.
- Made accessibility a first-class property of the library: keyboard support,
  focus management, and ARIA baked into every component; added axe-core checks
  to CI and remediated 40+ existing violations.
- Wrote the contribution guide and Storybook docs; grew the library's
  contributor base from 2 to 15 engineers across teams.

### Marigold Commerce — Frontend Engineer
*Austin, TX · June 2018 – January 2021*

- Led the accessibility remediation of the checkout flow to WCAG 2.1 AA,
  clearing a backlog of audit findings and adding regression tests to hold it.
- Rebuilt the product-listing UI in React, improving Largest Contentful Paint
  from ~4.5s to ~1.8s on mid-range mobile.
- Shipped the first shared component package used by the web and seller apps,
  reducing duplicated UI code between them.

### Brightpath Studio — Web Developer
*San Antonio, TX · August 2016 – May 2018*

- Built responsive marketing sites and small web apps for agency clients
  (JavaScript, SCSS, a headless CMS).
- Introduced the studio's first shared CSS conventions and component snippets.

## Education

**University of Texas at Austin** — B.A. Design (Minor: Computer Science),
2012–2016

## Selected Projects

- **token-bridge** — an open-source CLI that syncs Figma variables to design
  tokens; ~450 GitHub stars.
- **a11y-snippets** — a small collection of documented, accessible React
  component patterns used in workshops.
