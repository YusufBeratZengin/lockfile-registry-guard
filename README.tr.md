# lockfile-registry-guard

Onayladığınız registry'ler dışından paket indiren kilit dosyası girdilerini
reddeden, sıfır bağımlılıklı bir CI kapısı. `package-lock.json` /
`npm-shrinkwrap.json`, `yarn.lock` (Classic v1 ve Berry v2+) ve
`pnpm-lock.yaml` (v5, v6, v7, v9) dosyalarını okur ve her indirme referansını
politikaya göre denetler.

- Registry host'ları: tarball URL'leri yalnızca allowlist'teki host'lara
  yönelebilir.
- Git bağımlılıkları: host allowlist'i, HTTPS zorunluluğu ve isteğe bağlı tam
  commit SHA sabitlemesi. Git URL'sine gömülü kimlik bilgileri de raporlanır.
- Scope'lar: `@scope` paketleri ayrı bir registry'ye sabitlenebilir.
- Çıktı: insan tarafından okunabilir metin, JSON veya GitHub code scanning için
  SARIF 2.1.0.

Node.js 18 veya üzeri gerekir. Çalışma zamanı bağımlılığı yoktur.

## Kurulum

```bash
npm install --save-dev lockfile-registry-guard
```

Doğrudan `npx lockfile-registry-guard` ile ya da bir npm script'i üzerinden
çalıştırın:

```json
{
  "scripts": {
    "guard": "lockfile-registry-guard"
  }
}
```

## Kullanım

```bash
# Bulunulan dizini tara
lockfile-registry-guard

# Tek dosya veya bir dizin tara
lockfile-registry-guard package-lock.json
lockfile-registry-guard ./packages/app

# Varsayılanları bozmadan kurumsal registry ekle
lockfile-registry-guard --add-host nexus.corp.example

# Registry allowlist'ini değiştir ve özel git host'una izin ver
lockfile-registry-guard --allowed-hosts registry.npmjs.org,nexus.corp.example \
  --allow-git-hosts github.com,git.corp.example

# Git bağımlılıkları için 40 karakterlik commit SHA zorunlu olsun
lockfile-registry-guard --require-git-commit-pin

# Makine tarafından okunabilir çıktı ve code scanning için SARIF
lockfile-registry-guard --json
lockfile-registry-guard --format sarif --sarif-file reports/guard.sarif
```

Çıkış kodları sabittir:

| Kod | Anlamı |
| --- | --- |
| 0 | Kapı geçti |
| 1 | En az bir politika ihlali |
| 2 | Kullanım veya yapılandırma hatası |

## Seçenekler

| Seçenek | Açıklama |
| --- | --- |
| `--allowed-hosts <host[,host...]>` | Registry allowlist'ini değiştirir. Tekrarlanabilir. |
| `--add-host <host[,host...]>` | Registry allowlist'ine ekler. Tekrarlanabilir. |
| `--allow-git-hosts <host[,host...]>` | Git bağımlılıkları için izinli host'lar. Tekrarlanabilir. |
| `--scope <@scope=host[,host...]>` | Bir paket scope'u için zorunlu registry host'ları. Tekrarlanabilir. |
| `--enforce-https` / `--no-enforce-https` | Düz HTTP'yi reddet veya izin ver. Varsayılan: etkin. |
| `--allow-file-refs` / `--no-allow-file-refs` | `file:`, `link:`, `portal:`, `workspace:` ve `patch:` referanslarına izin ver. Varsayılan: izinli. |
| `--require-git-commit-pin` | `#` sonrasında 40 karakterlik tam commit SHA zorunlu olsun. |
| `--fail-on-warnings` | Uyarılar da kapıyı düşürsün. |
| `--max-violations <n>` | En fazla `n` ihlal raporla (`0` sınırsız demektir). |
| `--format <human\|json\|sarif>` | Çıktı biçimi. Varsayılan `human`. |
| `--json` | `--format json` kısayolu. |
| `--sarif-file <path>` | Ayrıca SARIF 2.1.0 belgesi yaz. |
| `--config <path>` | JSON yapılandırma dosyasını oku. |
| `--cwd <dir>` | Keşif ve göreli yollar için kullanılacak dizin. |
| `--quiet` | Yalnızca ihlalleri ve sonucu yazdır. |
| `--no-color` | ANSI renklerini kapat. |
| `-h`, `--help` | Yardımı göster. |
| `-v`, `--version` | Sürümü göster. |

Liste seçenekleri tam olarak bir argüman alır. Birden fazla host için virgül
kullanın veya seçeneği tekrarlayın. Böylece konumsal tarama hedefi yanlışlıkla
host sanılmaz.

## Yapılandırma dosyası

Çalışma dizininde bulunan ilk dosya kullanılır:

1. `.lockfileguardrc`
2. `.lockfileguardrc.json`
3. `lockfileguard.config.json`

Dosya JSON'dur. `--config <path>` veya `LOCKFILE_GUARD_CONFIG` ortam değişkeni
başka bir dosyayı gösterebilir. Bilinmeyen anahtarlar reddedilir; böylece bir
yazım hatası politikayı sessizce zayıflatamaz.

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

`scoped` ayrıca `{"@corp": {"hosts": ["nexus.corp.example"]}}` biçimini kabul
eder. Scope'lu bir paket başka bir host'tan çözülürse
`SCOPE_REGISTRY_MISMATCH` üretilir. Bir scope tarafından ayrılmış registry
host'ları, scope'suz paketlere hizmet edemez
(`PRIVATE_REGISTRY_FOR_PUBLIC_PACKAGE`).

## Ortam değişkenleri

| Değişken | Etkisi |
| --- | --- |
| `LOCKFILE_GUARD_CONFIG` | Yapılandırma dosyasının yolu. |
| `LOCKFILE_GUARD_ALLOWED_HOSTS` | Virgülle ayrılmış registry allowlist'i. Yapılandırma dosyasını ezer, `--allowed-hosts` tarafından ezilir. |
| `NO_COLOR` | İnsan raporundaki renkleri kapatır. |

## Kurallar

| Kod | Önem | Anlamı |
| --- | --- | --- |
| `HOST_NOT_ALLOWED` | error | Tarball URL host'u `allowedHosts` içinde değil. |
| `INSECURE_PROTOCOL` | error | Düz HTTP veya şifrelenmemiş git taşıması. |
| `INVALID_URL` | error | Referans bir URL, git remote veya yerel yol değil. |
| `CREDENTIALS_IN_URL` | error | URL userinfo'sunda token veya parola var. |
| `SCOPE_REGISTRY_MISMATCH` | error | Scope'lu paket kendi kuralı dışındaki host'tan çözüldü. |
| `PRIVATE_REGISTRY_FOR_PUBLIC_PACKAGE` | error | Scope'suz paket, yalnızca scope'a ayrılmış host'tan geldi. |
| `GIT_HOST_NOT_ALLOWED` | error | Git remote host'u `allowedGitHosts` içinde değil. |
| `GIT_COMMIT_NOT_PINNED` | warning | `requireGitCommitPin` açık ve referans tam SHA değil. |
| `FILE_REF_NOT_ALLOWED` | error | `allowFileRefs` kapalıyken yerel referans kullanılmış. |
| `PARSE_ERROR` | error | Kilit dosyası bozuk, doğrulanamıyor. |
| `NO_LOCKFILE` | error | Taranan dizinde desteklenen kilit dosyası yok. |

Standart SSH kullanıcısı `git@host` (`ssh://git@host` dahil) gömülü kimlik
bilgisi sayılmaz. Parola ya da kullanıcı adı olarak taşınan token işaretlenir.

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

## Programatik API

`lib/index.js`, CLI'ın kullandığı parçaları dışa aktarır; süreç başlatmadan
başka bir araçtan çalıştırabilirsiniz:

```js
const { createConfig, validateLockfile } = require('lockfile-registry-guard');

const config = createConfig({ requireGitCommitPin: true });
const result = validateLockfile(text, { file: 'pnpm-lock.yaml', config });
if (!result.ok) {
  for (const item of result.violations) console.error(item.code, item.name, item.message);
}
```

`parseLockfile`, `parseArgs`, `resolveConfig`, `validateEntries` ve
`defaultConfig` de dışa aktarılır.

## Geliştirme

Proje bilinçli olarak bağımlılıksızdır. Test altyapısı `test/harness.js`
içindedir; `test/suites/` altındaki her dosya `test/index.js` tarafından
yüklenir.

```bash
npm test           # tüm suite'leri çalıştır
npm run lint       # sözdizimi, boşluk ve depo hijyeni
npm run typecheck  # require() grafiği ve JSDoc tip import'ları çözülüyor mu
npm run check      # lint + typecheck + testler
npm run coverage   # lib/ ve bin/ için V8 satır kapsamı
```

## Lisans

MIT. Bkz. [LICENSE](LICENSE).
