# lab-agents

Spawnable, killable agents for a home NAS, with a React console built from Hexagon components. The app runs the agent engine and stores its data on the NAS while a local Ollama endpoint supplies the model.

Image: `ghcr.io/theatomiclabs/lab-agents` (private first). Port: `8787`.

## 1. Push to GitHub and publish the image
Rename this folder to `lab-agents`, create an empty **private** repo `theatomiclabs/lab-agents` on GitHub, then:
```bash
cd lab-agents
git init -b main
git add . && git commit -m "Phase 0: pipeline skeleton"
git remote add origin git@github.com:theatomiclabs/lab-agents.git
git push -u origin main
git tag v0.1.0 && git push origin v0.1.0     # the tag triggers the build
```
Watch the run under the repo's **Actions** tab. When it's green, the image appears under **Packages** with tags `0.1.0` and `latest`.

## 2. Let the NAS pull it (private image)
1. On GitHub, create a **personal access token (classic)** with only the `read:packages` scope.
2. SSH into the NAS and log in once:
```bash
echo YOUR_TOKEN | sudo docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```
3. Prepare the data folder and find your NAS user's numbers:
```bash
sudo mkdir -p /volume1/docker/lab-agents
id YOUR_NAS_USER            # note uid and gid
sudo chown YOUR_NAS_USER /volume1/docker/lab-agents
```

## 3. Run it (Container Manager)
1. Put `docker-compose.yml` and a `.env` (copy `.env.example`, set `PUID`/`PGID`, optionally `TAG=0.1.0`) in a folder such as `/volume1/docker/lab-agents-project`.
2. Container Manager -> **Project** -> **Create**, set that path, then build and start.
3. Open `http://<NAS-IP>:8787` for the console. Open `/healthz` to check app storage and the running build.
4. If the firewall is on, allow TCP 8787 from your LAN.

## Notes
- The image is built for `linux/amd64` (your DS920+). To run it on your Apple Silicon Mac, build locally with `docker build -t lab-agents .`.
- GHCR image names must be lowercase. If your GitHub org has capital letters, use the lowercase form in `docker-compose.yml`.
- Update the NAS: tag a new version (`v0.1.1`), set `TAG` in `.env`, then rebuild the project.
- Local dev uses Node 22.13 or later. Run `npm ci`, `npm run build`, and `npm start`. Open `http://127.0.0.1:8787/` and sign in with DSM or a provisioned local administrator. See [authentication setup](docs/phase-6.md) and the [console guide](docs/phase-10.md).

## Decisions so far
- **Login (Phase 6):** DSM accounts with two-step verification support and a local SQLite administrator fallback.
- **Registry:** GitHub Container Registry, private first.
- **UI (Phase 10):** React, using the Hexagon component library.
- **Database:** SQLite, from Phase 1.
