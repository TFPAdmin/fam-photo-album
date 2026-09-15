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

## Owner password recovery

1. In Cloudflare → Workers & Pages → `fam-photo-album` → Settings → Variables and Secrets, add a **Secret** named exactly `reset_secret` (lowercase). Use a newly generated random value of 32–256 characters, such as a password-manager-generated key or `openssl rand -hex 32`. Save/deploy the change. This must be a runtime secret, not a build variable.
2. Open **https://familyphotoalbum.xyz/?owner-reset=1**. This page is not linked from normal sign-in. Its URL is not an authentication credential; the secret is required.
3. Enter the key and a new password of 12–128 characters, then confirm the password. The existing owner account is recovered, all its sessions are revoked, and its username is shown so you can sign in. No media or other accounts are changed.
4. The key becomes unusable immediately on success. Remove `reset_secret` from Cloudflare when convenient. For another recovery, configure a **different** random value. Re-adding any previously used value will not work.

Automatic single-use invalidation is implemented in D1: only the key's SHA-256 fingerprint is retained in `settings`, and consuming the key, changing the password and revoking sessions occur in one transaction. Failed validation does not consume a key; concurrent requests cannot consume it twice. Missing or short secrets disable recovery. Requests are rate-limited and require the same origin. Recovery can also restore a disabled owner account.

The application does **not** delete the binding from Cloudflare: that requires a separate Cloudflare management API credential. No such credential is required or stored by this feature. Used-key records must be retained; restoring an older D1 backup can restore older recovery state, so remove/rotate the runtime secret after a database restore. Never commit recovery keys to GitHub or include them in URLs.

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
