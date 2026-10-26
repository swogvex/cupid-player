# Security Policy

## Supported Versions

Security fixes are provided for the latest deployed version of [swogvex.dev](https://swogvex.dev), corresponding to the current production release from `main`.

Previous deployments and unreleased development versions are not officially supported. Vulnerabilities affecting the current production version should be reported as described below.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately by emailing **Git.swogvex@gmail.com**.

Please do not disclose security vulnerabilities through public GitHub issues, discussions, pull requests, or other public channels before they have been investigated.

When submitting a report, include as much of the following information as possible:

- **Affected component:** The URL, page, API endpoint, or application component involved.
- **Description:** A clear explanation of the vulnerability and its potential impact.
- **Reproduction steps:** A minimal, reproducible sequence of steps.
- **Environment:** The browser, operating system, and relevant tools or versions.
- **Evidence:** Relevant screenshots, HTTP requests and responses, logs, or a proof of concept, with sensitive information removed.
- **Suggested mitigation:** If known, a proposed fix or recommendation.

Please avoid including passwords, authentication tokens, personal information, or other secrets in your report unless strictly necessary. Redact sensitive values from any supporting evidence.

### Response and Disclosure

This is an independently maintained project handled on a best-effort basis.

Reports will be reviewed as time permits. An acknowledgement or resolution within a specific timeframe is not guaranteed.

Please allow reasonable time for investigation and remediation before publicly disclosing a vulnerability. If a report concerns an active security incident or an issue affecting users, clearly indicate its severity and potential impact.

Submitting a report does not guarantee that it will be accepted as a vulnerability, that a fix will be released, or that a public security advisory will be published.

## Scope and Security Model

The project uses Astro for its web interface and is deployed on Vercel. It also includes backend/API functionality and forms. It does not use a database or provide user authentication, according to the current project configuration.

The security boundary therefore includes both browser-side functionality and any server-side processing exposed through the application's API or forms.

Relevant attack surfaces include, but are not limited to:

- Cross-site scripting (XSS) and unsafe handling of untrusted content.
- Injection vulnerabilities and insufficient input validation in API endpoints or form processing.
- Cross-site request forgery (CSRF), where applicable to state-changing operations.
- Clickjacking and other browser-based attacks.
- Insecure handling of cookies, browser storage, and user-supplied data.
- Information disclosure through errors, responses, logs, or exposed configuration.
- Third-party integrations and external resource loading.
- Vulnerable dependencies and insecure build or deployment configuration.
- Misconfigured HTTP security headers and Content Security Policy (CSP).

The absence of a database or user authentication does not eliminate these risks. All externally reachable endpoints and data-processing paths should be assessed according to their actual behavior.

## HTTP Security Headers

HTTP security headers are configured through `vercel.json`. The production deployment is tested to verify the expected header configuration.

| Header | Intended protection |
| --- | --- |
| `Strict-Transport-Security` | Enforces HTTPS for browsers that have received the policy. |
| `Content-Security-Policy` | Restricts permitted script, style, image, connection, and frame sources. |
| `X-Frame-Options: DENY` | Provides legacy protection against framing and clickjacking. |
| `X-Content-Type-Options: nosniff` | Prevents browsers from interpreting content as a different MIME type. |
| `Referrer-Policy: strict-origin-when-cross-origin` | Limits referrer information sent to other origins. |
| `Permissions-Policy` | Restricts access to browser features and powerful APIs. |
| `Cross-Origin-Opener-Policy: same-origin` | Isolates the browsing context from cross-origin documents. |
| `Cross-Origin-Resource-Policy` | Restricts cross-origin resource loading, with an exception for the public Open Graph image where required. |
| `X-Permitted-Cross-Domain-Policies: none` | Disables cross-domain policy files for legacy clients. |

`Cross-Origin-Embedder-Policy` is intentionally not enabled because it may interfere with the site's third-party embedding requirements.

The `interest-cohort` directive is not used in `Permissions-Policy` because the associated feature is obsolete.

### HSTS Considerations

The configured HSTS policy is intended to enforce HTTPS in supporting browsers.

The `preload` directive does not itself add a domain to browser preload lists. Preload inclusion is a separate process with eligibility requirements and should not be assumed unless the domain has actually been accepted and published.

## Content Security Policy

The site uses a restrictive Content Security Policy intended to reduce the impact of script injection and limit the origins from which browser resources can be loaded.

The policy is configured through the application's deployment configuration. Its directives include the following restrictions:

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
media-src 'self';
frame-src https://www.youtube-nocookie.com;
manifest-src 'self';
worker-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
require-trusted-types-for 'script'
```

The deployed configuration is authoritative. The policy above documents the intended restrictions and must remain consistent with `vercel.json` and the automated security tests.

### CSP Design Principles

- **Scripts:** First-party scripts are preferred. Avoid adding `unsafe-inline` or `unsafe-eval` to `script-src`.
- **Styles:** Keep styles in external stylesheets or apply dynamic changes through safe, controlled DOM APIs. Do not weaken the policy merely to accommodate avoidable inline styles.
- **Images:** Images should be self-hosted where practical. The `data:` source is retained for the required inline image or mask use case.
- **Fonts:** Fonts are self-hosted rather than loaded from external font providers.
- **Connections:** Connections are restricted to the site's own origin. First-party analytics and performance monitoring must remain compatible with this policy.
- **Frames:** YouTube embeds use `youtube-nocookie.com` and are created only after the visitor explicitly requests to watch a demo.
- **Object embedding:** `object-src 'none'` disables legacy plugin content.
- **Document base and forms:** `base-uri 'self'` and `form-action 'self'` restrict document base URLs and form submission destinations.
- **Framing:** `frame-ancestors 'none'` prevents other sites from embedding the portfolio.
- **HTTPS:** `upgrade-insecure-requests` instructs supporting browsers to upgrade insecure resource requests.
- **Trusted Types:** `require-trusted-types-for 'script'` enables Trusted Types enforcement for supported script-related DOM injection sinks.

Any change to the CSP must be tested against the production application's actual functionality, including routing, animations, forms, API requests, analytics, and third-party embeds.

### Trusted Types

Trusted Types are enabled as an additional mitigation against certain DOM-based injection vulnerabilities in supporting browsers.

Trusted Types do not replace input validation, output encoding, safe DOM manipulation, or a restrictive CSP. They also do not prevent every form of cross-site scripting.

Any changes to the application's routing, rendering, or third-party integrations must be tested for compatibility with the active Trusted Types policy.

### Changes Requiring Inline Styles

If a future change requires inline styles, use the following order of preference:

1. Move the styling into an external stylesheet or use appropriate classes and data attributes.
2. Use controlled DOM APIs for dynamic styling where compatible with the application's CSP.
3. Evaluate Astro's supported CSP mechanisms, including hashing where appropriate.
4. Consider a narrowly scoped exception only when the previous options are insufficient and the associated security impact has been assessed.

Do not add `unsafe-inline` to `script-src` as a workaround. Any CSP relaxation must be documented, tested, and reflected in the automated security checks.

## Third-Party Services and Privacy

The portfolio uses Vercel for deployment and integrates Vercel Analytics and Vercel Speed Insights. It also supports YouTube embeds.

The project is configured with privacy controls for analytics, including Global Privacy Control (GPC), Do Not Track (DNT), and an opt-out mechanism. These controls are tested as part of the privacy implementation.

The following principles apply:

- Self-host assets where practical to reduce unnecessary third-party requests.
- Load YouTube embeds only after an explicit visitor action.
- Avoid collecting information that is not necessary for the site's functionality.
- Respect the implemented analytics privacy controls.
- Review third-party integrations when their behavior, configuration, or privacy implications change.

The application uses cookies and browser storage. Their exact purposes, contents, lifetimes, and applicable controls must be documented in the site's privacy policy and kept consistent with the deployed implementation.

This security policy does not replace the privacy policy or describe every detail of personal-data processing.

## Input Validation and Data Handling

Backend/API endpoints and forms must treat incoming data as untrusted, regardless of whether it originates from the portfolio's own interface.

Security-sensitive changes should follow these principles:

- Validate input on the server side, where server-side processing is involved.
- Enforce appropriate length, type, and format limits.
- Avoid constructing executable code, database queries, shell commands, or HTML from untrusted input.
- Use context-appropriate output encoding and safe DOM APIs.
- Return only the information required by the client.
- Avoid exposing secrets, internal stack traces, environment variables, or sensitive operational details in responses.
- Apply appropriate abuse prevention and rate limiting to publicly accessible endpoints where warranted.
- Avoid logging passwords, tokens, or unnecessary personal information.
- Review error handling to ensure failures do not expose sensitive implementation details.

Client-side validation is a usability measure and must not be treated as a substitute for server-side validation.

## Cookies and Browser Storage

Cookies, `localStorage`, and `sessionStorage` can expose information to scripts running in the relevant browser context. Their use must therefore be limited to documented purposes.

When changing storage or cookie behavior:

- Do not store passwords, secrets, or sensitive authentication material in browser storage.
- Use appropriate cookie attributes, including `Secure`, `HttpOnly`, and `SameSite`, where applicable to the cookie's purpose and access requirements.
- Minimize the amount and lifetime of stored data.
- Ensure privacy controls behave consistently across relevant routes and navigation flows.
- Avoid treating browser-provided state as trustworthy authorization or validation data.

The appropriate protections depend on the actual data stored and how it is accessed.

## Dependency and Supply Chain Security

The project uses `pnpm` and maintains a committed lockfile to support reproducible dependency installation.

The maintenance process includes:

- Installing dependencies in CI with `pnpm install --frozen-lockfile`.
- Using Dependabot for scheduled dependency update pull requests.
- Running `pnpm audit --audit-level high` as part of release checks.
- Running automated tests and security checks in CI.
- Reviewing dependency changes and relevant build configuration before deployment.

A clean dependency audit does not guarantee that an application is free from vulnerabilities. Dependency advisories, transitive dependencies, and changes in upstream packages should be reviewed as part of ongoing maintenance.

Security-relevant changes must not bypass the project's required CI checks.

## Responsible Testing

Security testing must be conducted responsibly and only against systems the tester is authorized to assess.

When investigating a suspected vulnerability:

- Use the minimum testing necessary to demonstrate the issue.
- Do not intentionally disrupt availability or degrade the service for other visitors.
- Do not access, modify, or delete other people's data.
- Do not attempt to obtain credentials, session tokens, or secrets belonging to others.
- Do not conduct social engineering or attacks against unrelated third parties.
- Do not perform destructive testing or create persistent access.
- Do not publicly disclose exploitable details before allowing reasonable time for investigation and remediation.

If testing unexpectedly exposes sensitive data or affects service availability, stop testing and report the issue privately.

These guidelines describe the project's preferred reporting and testing process. They do not constitute a blanket authorization to test infrastructure operated by Vercel, YouTube, or other third parties.

## Known Limitations and Residual Risks

Security controls reduce risk but cannot guarantee that the application is free from vulnerabilities.

The following limitations remain relevant:

- Security headers and CSP must continue to be checked after deployment because configuration changes can introduce regressions.
- Trusted Types and CSP do not eliminate all injection risks.
- Third-party services operate under their own security and privacy policies.
- Dependency audits cannot detect every vulnerable dependency or application-level security flaw.
- Backend/API endpoints and form-processing logic require review according to their specific behavior.
- Privacy controls must be retested whenever analytics, cookies, storage, or third-party integrations change.
- Security testing tools provide useful evidence but do not constitute a complete security assessment.

Any newly identified material limitation should be documented and addressed according to its severity and practical impact.

## Security Verification

The project includes automated checks for security-related configuration and behavior.

Run the following commands from the repository root when validating a change:

```bash
pnpm install --frozen-lockfile
pnpm build
node scripts/test-headers.mjs
pnpm audit --audit-level high
```

The header test checks the repository's security configuration and the relevant generated output. The complete CI workflow should also pass before deployment.

To verify the deployed site, run:

```bash
node scripts/test-headers.mjs https://swogvex.dev
```

Use the repository's configured local distribution server when testing production-like response headers locally. A development server or ordinary preview server may not reproduce the deployed headers.

After deployment, review the live response headers and confirm that security-sensitive functionality still works, including:

- Navigation and View Transitions.
- Client-side interactions and animations.
- Forms and API requests.
- YouTube embeds after explicit user interaction.
- Analytics privacy controls, including GPC, DNT, and opt-out behavior.
- CSP and Trusted Types enforcement.

Additional external assessments may be performed using services such as Security Headers, Mozilla Observatory, and Google's CSP Evaluator. These tools provide supplementary feedback and should not be treated as proof that the site is secure.

Record relevant findings and remediation work in `docs/SECURITY_CHECKLIST.md`.

## Policy Changes

This policy may be updated as the project evolves, new features are introduced, or security requirements change.

The repository's current version of this document describes the intended security practices for the project. Actual deployment configuration and application behavior remain the source of truth for determining which controls are active.
