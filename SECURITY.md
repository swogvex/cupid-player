# Security Policy

## Overview

Security is an important consideration in Cupid Player. Although the application is currently in beta and remains under active development, security vulnerabilities should be reported and handled responsibly.

This policy explains which versions are covered, how to report potential vulnerabilities, and what users can expect during the disclosure process.

## Supported Versions

Cupid Player is currently under active development. Security fixes are prioritized for the latest supported release.

| Version | Security Support |
| --- | --- |
| Latest beta release | Supported on a best-effort basis |
| Older beta releases | Not guaranteed |
| Development builds | Not guaranteed |

Users are encouraged to use the latest available release and keep the application and its dependencies up to date.

Because this project is in beta, security fixes, compatibility, and support cannot be guaranteed for every release.

## Reporting a Vulnerability

**Please do not disclose suspected security vulnerabilities in public GitHub Issues, discussions, or pull requests.**

Public disclosure before a vulnerability has been assessed and addressed may expose users to unnecessary risk.

If you discover a potential security vulnerability, please report it privately through GitHub's security reporting feature, if it is enabled for this repository.

You can find the repository's available reporting options under:

**Repository → Security → Report a vulnerability**

If private vulnerability reporting is unavailable, please contact the repository maintainer privately through an appropriate contact method listed on their GitHub profile. Do not include sensitive exploit details in a public issue.

Please do not assume that a public issue is a private or secure reporting channel.

## What to Include in a Report

To help investigate and reproduce the issue, please include as much of the following information as you can safely provide:

- **Summary:** A clear description of the potential vulnerability.
- **Affected version:** The release, commit, or build in which the issue was observed.
- **Environment:** Your operating system and relevant application or dependency versions.
- **Reproduction steps:** A concise, step-by-step explanation of how to reproduce the issue.
- **Impact:** What an attacker might be able to do and under which circumstances.
- **Evidence:** Relevant logs, screenshots, or a minimal proof of concept, provided they do not expose personal information or create additional risk.
- **Suggested mitigation:** If known, a potential fix or way to reduce the risk.

Please redact passwords, access tokens, private URLs, personal information, and other secrets before submitting a report.

## Scope

Reports are particularly relevant when they demonstrate a security impact involving Cupid Player or its distribution, including:

- **Command execution:** Unsafe handling of external processes, command arguments, or downloaded content.
- **Download handling:** Vulnerabilities involving untrusted URLs, downloaded files, or media-processing tools.
- **Local data:** Unauthorized access to, modification of, or loss of application data beyond the expected behavior of the application.
- **Sensitive information:** Accidental exposure of credentials, tokens, or other confidential information.
- **Application security:** Vulnerabilities affecting the Tauri application, its frontend-to-backend communication, or its Rust backend.
- **Dependencies and packaging:** Vulnerable dependencies or distribution practices that create a demonstrable security risk.

A report should describe a reproducible security impact rather than only a theoretical concern.

## Out of Scope

The following are generally outside the scope of this policy unless they demonstrate a separate, concrete security vulnerability:

- General bugs without a security impact.
- Feature requests and usability suggestions.
- Issues affecting unsupported or significantly outdated development environments without a demonstrable vulnerability.
- Vulnerabilities in third-party services that cannot be attributed to Cupid Player.
- Reports based solely on automated scanner output without evidence of an exploitable issue.
- Social engineering, physical attacks, or attacks requiring access that is already equivalent to the affected user's privileges.

This section does not exclude genuine vulnerabilities simply because they involve a third-party dependency. If Cupid Player's implementation or configuration introduces or meaningfully increases the risk, please report it.

## Disclosure and Response Process

After receiving a report, the maintainer will make a reasonable effort to:

1. Review the
