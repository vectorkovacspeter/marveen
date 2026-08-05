# Köszönet

A Marveen több nyílt forrású projektre és koncepcióra épít. Ez a dokumentum azokat a forrásokat kreditálja, amelyek beépültek a kódbasebe vagy érdemi hatással voltak a tervezésre.

A Marveen saját licensze: [LICENSE](./LICENSE) (MIT).

## Becsomagolt vagy adaptált kód

### Bumblebee (ellátási-lánc biztonsági scanner)
- **Forrás**: https://github.com/perplexityai/bumblebee
- **Szerző**: Perplexity AI
- **Licensz**: Apache 2.0
- **Hol a Marveen-ben**: `seed-scheduled-tasks/bumblebee-hygiene-scan/` (a bináris, a scan profil és a beépített threat-intel katalógusok az integráció időpontjában aktuális verziójukkal)
- **Mit csinál nálunk**: heti hétfő 09:00-kor read-only leltár a telepített csomagokról, MCP konfigurációkról és kiterjesztésekről, összeillesztve a beépített ellátási-lánc fenyegetés-katalógusokkal. Csak találat esetén szól.

### Zhutov skill csomag (handoff / retrospective / skill-management)
- **Forrás**: https://artemxtech.substack.com/p/3-claude-code-skills-that-make-claude
- **Szerző**: Artem Zhutov
- **Hol a Marveen-ben**: `seed-skills/handoff/`, `seed-skills/retrospective/`, `seed-skills/skill-management/`
- **Mit csinál nálunk**: a skill-csontváz a Marveen flotta-architektúrájára adaptálva. Az 5-szekciós handoff struktúra (Goal, Current Progress, What Worked, What Didn't Work, Next Steps), a sub-agent retrospective minta, és a skill-rot életciklus-kezelés koncepció mind Zhutov csomagjából származik. A megvalósítás TypeScript-ben újraírva, integrálva a Marveen checkpoint, DREAM, memória és inter-agent message rendszereivel.

### printing-press (agent-CLI generátor)
- **Forrás**: https://github.com/mvanhorn/cli-printing-press
- **Szerző**: Mike Van Horn
- **Hol a Marveen-ben**: generátor eszközként használjuk (nem becsomagolva) -- ezzel készülnek a `skool-cli`, `aiam-blog-pp-cli`, `connectors-hu` CLI csomagok, amelyek külső API-kat csomagolnak, plus a hozzájuk tartozó Claude Code skill fájlok.

## Koncepcionális hatás (nem becsomagolt kód)

### Mark Kashef -- Claude Code-alapú AI-asszisztens architektúra
- **Forrás**: https://youtube.com/@mark_kashef
- **Hol a Marveen-ben**: a Marveen alapkoncepciója (Claude Code mint folyamatosan futó AI-asszisztens, saját Telegram-csatornával, tmux-session-alapú headless működéssel, scheduled-task-okkal). A közösség a megközelítést "Claude Claw" / "ClaudeClaw" néven hivatkozza; a Marveen első verziója is ezen a néven indult (2026-04-08), nem fork, hanem a koncepció alapján nulláról felépített saját implementáció. A névváltás Marveen-re azután történt, hogy elegendő saját megoldás (memory tiers, kanban, channel-plugin, autonómia-config, multi-agent inter-agent messaging) került be ahhoz, hogy a projekt önálló identitást viseljen.

### Karpathy CLAUDE.md alapelvek
- **Forrás**: Andrej Karpathy CLAUDE.md útmutatása (publikus)
- **Hol a Marveen-ben**: a saját gyökér `CLAUDE.md` mintareferenciája. Nem másoltunk kódot; a felépítés és a szabály-stílus Karpathy mintájából inspirálódott.

### Matt Pocock -- "/handoff is my new favourite skill"
- **Forrás**: https://youtu.be/dtAJ2dOd3ko
- **Hol a Marveen-ben**: a "purpose" argumentum mint kötelező paraméter a `/handoff`-on, és a cross-agent portable design (hogy egy HANDOFF.md működjön Claude Code, Codex, Copilot CLI stb. között) Matt videós design-javaslataiból átvéve.

## Erről a forkról (`vectorkovacspeter/marveen`)

Ez a repó a [`Szotasz/marveen`](https://github.com/Szotasz/marveen) **forkja** (a fenti attribúciók az
upstream projektéi). A fork **válogatva** emeli át a nem-személyes, éles-minőségű változtatásokat a
[`R4CK/mikrob`](https://github.com/R4CK/mikrob) forkból — a gép- és személy-specifikus részek (hardcode-olt
útvonalak, tulajdonos-nevek, saját ágens-flotta) nélkül; a tulajdonos-értékek konfigurációba általánosítva.

- **`R4CK/mikrob`** — az átemelt nem-személyes funkciók forrása. Fázisonként:
  - **P1 biztonsági hardening** — modell-ID command-injection lezárása (allowlist + POSIX shell-escape minden
    ágens-indítási ponton), egress-gate URL-userinfo bypass javítás, opt-in `git-protect`/`secret-write`/
    `big-file` guard hookok. (Upstream **PR #866** — mergelve; **#867** Docker; **#874** guard hookok.)
  - **P2 modell- és költség-kezelés** — model-catalog / model-fallback (hysteresis), costops heti hard-stop /
    threshold / limit, local-LLM (Ollama offload) router + route, Gemini kliens/validáció, kanban-dispatch.
  - **P3 dashboard UI** — kanban ügynök-gyorsszűrő chipek, running/subagent-ring, Beépített repók oldal,
    Lokális LLM oldal, heti usage/threshold/model-tier widgetek, Gemini beállítás-fül.
  - **P4 seed tartalom** — generikus szerep-personák (`seed-agents/`), skillek (`seed-skills/`), ütemezett
    feladatok (`seed-scheduled-tasks/`) — személyes tartalom kiszűrve, tulajdonos-utalások placeholderre.
  - **P5 store/ + ops-scriptek** — local-LLM store réteg és skill-sablonok, RAG/shared-memory hookok (unwired).
  - **Docker** — multistage image + compose, token-biztos alapértelmezés (`RESPAWN_ENABLED=0` +
    `MARVEEN_AGENT_BACKEND=sdk`).

- **A fork saját, NEM átemelt munkája** (net-new, nem mikrob-eredetű): a **flotta-killswitch** (`/api/fleet/pause`
  soft/hard + dashboard vezérlő), az upstream-szinkron konfliktus-feloldások, és a Docker onboarding/elérhetőség
  javítások (írható `/app/.env` entrypoint, `WEB_HOST=0.0.0.0`).

A rendszer eredeti szerzője **Szota Szabolcs**; a mikrob fork szerzőinek munkáját a fenti nem-személyes
portolt részekért illeti köszönet.

---

Ha hiányzó attribúciót észlelsz vagy korrekciót szeretnél, nyiss egy issue-t vagy PR-t: https://github.com/Szotasz/marveen.
