# lockfile-registry-guard

Zero-dependency CI gate that rejects lockfile entries resolving outside your
approved registries. It reads `package-lock.json` / `npm-shrinkwrap.json`,
`yarn.lock` (Classic v1 and Berry v2+) and `pnpm-lock.yaml` (v5, v6, v7, v9),
then checks every download reference against a policy.

- Registry hosts: any tarball URL must point at an allowlisted host.
- Git dependencies: host allowlist, HTTPS enforcement and optional full-SHA
  pinning. Credentials embedded in a git URL are reported as well.
- Scopes: `@scope` packages can be pinned to a dedicated registry.
- Output: human readable text, JSON, or SARIF 2.1.0 for GitHub code scanning.

Node.js 18 or newer is required. There are no runtime dependencies.

## Install

```bash
npm install --save-dev lockfile-registry-guard
```

Run it directly with `npx lockfile-registry-guard` or through an npm script:

```json
{
  "scripts": {
    "guard": "lockfile-registry-guard"
  }
}
```

## Usage

```bash
# Scan the current directory
lockfile-registry-guard

# Scan one file or a directory
lockfile-registry-guard package-lock.json
lockfile-registry-guard ./packages/app

# Add a corporate registry without dropping the defaults
lockfile-registry-guard --add-host nexus.corp.example

# Replace the registry allowlist and allow a private git host
lockfile-registry-guard --allowed-hosts registry.npmjs.org,nexus.corp.example \
  --allow-git-hosts github.com,git.corp.example

# Require 40 character commit SHAs for git dependencies
lockfile-registry-guard --require-git-commit-pin

# Machine readable output and a SARIF report for code scanning
lockfile-registry-guard --json
lockfile-registry-guard --format sarif --sarif-file reports/guard.sarif
```

Exit codes are stable and safe to branch on:

| Code | Meaning |
| --- | --- |
| 0 | Gate passed |
| 1 | At least one policy violation |
| 2 | Usage or configuration error |

## Options

| Option | Description |
| --- | --- |
| `--allowed-hosts <host[,host...]>` | Replace the registry allowlist. Repeatable. |
| `--add-host <host[,host...]>` | Append to the registry allowlist. Repeatable. |
| `--allow-git-hosts <host[,host...]>` | Git hosts allowed for git dependencies. Repeatable. |
| `--scope <@scope=host[,host...]>` | Registry hosts required for one package scope. Repeatable. |
| `--enforce-https` / `--no-enforce-https` | Reject or allow plain HTTP. Enabled by default. |
| `--allow-file-refs` / `--no-allow-file-refs` | Allow `file:`, `link:`, `portal:`, `workspace:` and `patch:` refs. Allowed by default. |
| `--require-git-commit-pin` | Require a full 40 character commit SHA after `#`. |
| `--fail-on-warnings` | Make warnings blocking too. |
| `--max-violations <n>` | Report at most `n` violations (`0` means unlimited). |
| `--format <human\|json\|sarif>` | Output format. Default `human`. |
| `--json` | Shorthand for `--format json`. |
| `--sarif-file <path>` | Also write a SARIF 2.1.0 document. |
| `--config <path>` | Read a JSON configuration file. |
| `--cwd <dir>` | Directory used for discovery and relative paths. |
| `--quiet` | Only print violations and the verdict. |
| `--no-color` | Disable ANSI colours. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show the version. |

List options take exactly one argument. Use commas, or repeat the option, to
pass more than one host. That keeps a positional scan target from being
mistaken for a host.

## Configuration file

The first file found in the working directory wins:

1. `.lockfileguardrc`
2. `.lockfileguardrc.json`
3. `lockfileguard.config.json`

The file is JSON. `--config <path>` or the `LOCKFILE_GUARD_CONFIG` environment
variable can point at another file. Unknown keys are rejected so a typo cannot
silently weaken the policy.

```json
{
  "allowedHosts": ["registry.npmjs.org", "nexus.corp.example"],
  "allowedGitHosts": ["github.com", "git.corp.example"],
  "enforceHttps": true,
  "allowFileRefs": false,
  "requireGitCommitPin": true,
  "failOnWarnings": false,
  "format": "human",
  "sarifFile": "reports/guard.sarif",
  "scoped": {
    "@corp": ["nexus.corp.example"]
  }
}
```

`scoped` also accepts the object form `{"@corp": {"hosts": ["nexus.corp.example"]}}`.
A scoped package that resolves from any other host is reported as
`SCOPE_REGISTRY_MISMATCH`. Registry hosts reserved by a scope may not serve
unscoped packages (`PRIVATE_REGISTRY_FOR_PUBLIC_PACKAGE`).

## Environment variables

| Variable | Effect |
| --- | --- |
| `LOCKFILE_GUARD_CONFIG` | Path to the configuration file. |
| `LOCKFILE_GUARD_ALLOWED_HOSTS` | Comma separated registry allowlist. Overrides the config file, is overridden by `--allowed-hosts`. |
| `NO_COLOR` | Disable colours for the human report. |

## Rules

| Code | Severity | Meaning |
| --- | --- | --- |
| `HOST_NOT_ALLOWED` | error | Tarball URL host is not in `allowedHosts`. |
| `INSECURE_PROTOCOL` | error | Plain HTTP or an unencrypted git transport. |
| `INVALID_URL` | error | Reference is not a URL, git remote or local path. |
| `CREDENTIALS_IN_URL` | error | URL userinfo contains a token or password. |
| `SCOPE_REGISTRY_MISMATCH` | error | Scoped package resolved outside its scope rule. |
| `PRIVATE_REGISTRY_FOR_PUBLIC_PACKAGE` | error | Unscoped package served by a scope-only host. |
| `GIT_HOST_NOT_ALLOWED` | error | Git remote host is not in `allowedGitHosts`. |
| `GIT_COMMIT_NOT_PINNED` | warning | `requireGitCommitPin` is on and the ref is not a full SHA. |
| `FILE_REF_NOT_ALLOWED` | error | Local reference while `allowFileRefs` is false. |
| `PARSE_ERROR` | error | Lockfile is malformed and cannot be verified. |
| `NO_LOCKFILE` | error | No supported lockfile was found in the scanned directory. |

The standard SSH login `git@host` (and `ssh://git@host`) is not treated as an
embedded credential. A password, or a token used as the username, is.

## GitHub Actions

```yaml
name: lockfile-guard
on: [push, pull_request]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx lockfile-registry-guard --sarif-file guard.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: guard.sarif
```

## Programmatic API

`lib/index.js` exports the pieces the CLI uses, so the guard can run inside
another tool without spawning a process:

```js
const { createConfig, validateLockfile } = require('lockfile-registry-guard');

const config = createConfig({ requireGitCommitPin: true });
const result = validateLockfile(text, { file: 'pnpm-lock.yaml', config });
if (!result.ok) {
  for (const item of result.violations) console.error(item.code, item.name, item.message);
}
```

`parseLockfile`, `parseArgs`, `resolveConfig`, `validateEntries` and
`defaultConfig` are exported as well.

## Development

The project intentionally has no dependencies. The test harness lives in
`test/harness.js`; every file in `test/suites/` is loaded by `test/index.js`.

```bash
npm test           # run every suite
npm run lint       # syntax, whitespace and repository hygiene
npm run typecheck  # require() graph and JSDoc type imports resolve
npm run check      # lint + typecheck + tests
npm run coverage   # V8 line coverage for lib/ and bin/
```

## License

MIT. See [LICENSE](LICENSE).
