# Security

## Reporting

Report vulnerabilities privately through GitHub Security Advisories for
`vim-villain/content`. Do not open a public issue for an exploitable problem.

## Model

- Content is data-only YAML. There is no eval, dynamic import, or executable
  contribution path.
- The published runtime has zero dependencies, no filesystem or network access, and no
  Node built-ins.
- Reference solutions are not published, so an app cannot accidentally serialize them
  into a start response.
- CI validates schemas, IDs, pools, determinism, reference-solution replay, and the
  published artifact.

The hosted service is free. Do not include secrets, personal data, or tracking in
content.
