# The Family Photo Album

Private family photo and video storage for **https://familyphotoalbum.xyz**, built for Cloudflare Workers, D1 and R2.

## Deploy from GitHub

In Cloudflare, create a Worker connected to **TFPAdmin/fam-photo-album** and select the `main` branch.

| Setting | Value |
| --- | --- |
| Worker name | `fam-photo-album` |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Node version | `22.16.0` or newer supported Node 22 release |

The repository retains its pnpm lockfile and package-manager declaration. Cloudflare must install dependencies before running the build. If configuring the install command yourself, use `corepack pnpm install --frozen-lockfile`.

Before creating your owner account, add a Worker runtime **secret** named `SETUP_KEY` in Settings → Variables and Secrets. Use a private randomly generated value of at least 32 characters. Do not put it in GitHub, an ordinary public variable, or the build logs. For example, generate one locally with `openssl rand -hex 32`. Adding this secret in the Worker dashboard does not require committing it to this repository. The setup screen fails closed until it is configured.

The deploy command applies pending D1 migrations and then deploys the built Worker. The custom-domain route creates the `familyphotoalbum.xyz` mapping if the domain is an active zone in the same Cloudflare account and the deployment token has the necessary permissions. If Cloudflare reports an existing conflicting DNS record, resolve that record in the dashboard before retrying. Do not enable a public R2 bucket domain.

### Configured resources

| Resource | Configuration |
| --- | --- |
| Cloudflare account | `33110daa5aadd8df2fc259536b3076f6` |
| D1 binding | `DB` |
| D1 database | `fam-photo-album` |
| D1 ID | `2dac0c2c-9f24-4ef2-a509-2e3f86b9faa1` |
| R2 binding | `BUCKET` |
| R2 bucket | `fam-photo-album` |
| Custom domain | `familyphotoalbum.xyz` |

The supplied R2 URL is the S3 API endpoint. This application accesses R2 through the Worker binding; it needs no S3 access key and does not expose that endpoint in the interface. Deployment authorization must allow Worker publishing, the configured D1 migrations, bucket binding and custom-domain setup. Resource IDs alone do not grant deployment access.

After deployment, open the domain, enter `SETUP_KEY`, and create the owner username and password. This installation uses the supplied D1/R2 resources. Accounts or media from the separate ChatGPT preview are not migrated automatically.

## Accounts and sharing

- **Owner:** full access to accounts and media; can create admins and members. The owner account is omitted from the directory returned to admins and members. In All family media, choose a family member to filter their collection.
- **Admin:** creates member accounts, resets member passwords and enables/disables members. Does not automatically gain access to member media or manage owner/admin credentials.
- **Member:** manages a private collection and albums. Selects individual family members who may view and download a file. Recipients cannot edit or re-share it through the app.
- Temporary passwords must be changed at first sign-in. Changing your own password rotates the session cookie and revokes all previous sessions. Admin resets revoke the target member’s sessions while preserving the administrator’s session. Expired or changed accounts return the interface to sign-in rather than leaving stale account controls visible.
- No public account registration or ChatGPT authentication. Login, password and setup attempts are rate-limited, and writes require the same request origin.

## Account Center and password recovery

Every account (owner, admin and member) has an **Account Center**, available from the account icon or navigation menu. Members can edit their display name, change their password and configure or remove three recovery questions. Usernames and roles cannot be changed through profile editing.

Before forgetting a password, sign in, open **Account Center → Password recovery**, choose three different questions, enter answers and confirm your current password. Options include birthday, anniversary, wedding location/date, oldest child, first pet, school, childhood street and a special place. Answers are case-insensitive, Unicode-normalized, and ignore surrounding/repeated spaces. Use YYYY-MM-DD consistently for dates. Saved answers are never displayed; replacing questions requires three new answers.

Use **Forgot password?** on sign-in, or **https://familyphotoalbum.xyz/?reset-password=1**. Enter your username, select your three saved questions (in any order), supply all three answers and choose/confirm a new password. A successful reset revokes every session for that account and returns you to sign-in. The questions remain configured until changed or removed. The public form does not reveal selected questions, usernames or roles; unknown, disabled, unconfigured and incorrect-answer cases share the same error message. Attempts are limited per username and IP. Disabled accounts cannot recover access using answers.

**Security limitation:** birthdays and family facts are often known or discoverable. Questions alone are weaker than verified email recovery or recovery codes, and [OWASP recommends against using them as the sole reset mechanism](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html#security-questions). Choose private answers (they need not be literal facts), keep them in a password manager, and treat all three as a recovery password. Answers are stored only as independently salted PBKDF2 hashes in the existing D1 `settings` table; no migration or new Cloudflare secrets are needed.

Admins can still issue temporary member passwords; only the owner can reset admins. An administrative reset clears the target's recovery questions to prevent previous answers from bypassing the reset. After choosing a new password, the member must configure questions again. Accounts without configured questions require administrator help. An owner who is already locked out and has not configured questions requires a separate verified administrative recovery; this feature cannot establish trusted answers while signed out.

The previous `reset_secret` owner recovery feature and `?owner-reset=1` screen are removed. The old API endpoint returns 404, even if that secret remains configured. You can delete `reset_secret` in Cloudflare. Previous password/session fixes are preserved; existing media and accounts are unchanged. Unused owner-recovery fingerprint records are retained but no longer read.

## Original-file protection

Files upload in 8 MiB chunks, with SHA-256 checked between the browser and Worker. After multipart completion, each stored range is read back from R2 and compared with its upload hash. The file becomes **Verified** and visible only when all checks pass. Downloads stream originals and support byte ranges for video playback. JPEG thumbnails are optional previews; originals are not compressed by the application. Files up to 20 GiB are supported.

This website uploads files selected by the user. It does not automatically synchronize a phone in the background or delete phone photos. Retrying unfinished uploads works within the current tab; cross-tab/restart resumability is not implemented. Keep originals if the tab closes before verification. Enable an R2 lifecycle rule to abort incomplete multipart uploads; finalized but unverified abandoned objects can still require owner maintenance.

Recently removed files remain recoverable and continue to use storage. Permanent deletion is not exposed. Browser support varies for HEIC/HEIF and video codecs; download originals into a compatible application where necessary. To preserve Live Photos, export/upload both photo and video components. A phone's file picker can apply its own export conversion before the application receives the file.

**Verified confirms transfer integrity, not independent redundancy.** Check downloaded originals and keep another independent copy of irreplaceable media before deleting phone copies.

## Development

- `npm run build`: compile Worker and assets using the retained framework and lockfile.
- `npm test`: isolated API integration checks with Miniflare, D1 and R2.
- `node node_modules/typescript/bin/tsc --noEmit`: type validation.
- `npm run db:generate`: generate a new Drizzle migration after a schema change.
- `npm run deploy`: apply migrations and publish the current build.

No family media or test accounts are seeded into production. The optional WebMCP upload-panel helper is feature-detected; a supported WebMCP execution environment was unavailable for validation. Browser/device QA has not yet been performed.
