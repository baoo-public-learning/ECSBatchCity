# AGENTS.md

Read and follow `IMPLEMENTATION_BRIEF.md` before changing this repository.

- Keep `src/sim` independent of Vue, Pinia, Three.js, Tailwind CSS, and the DOM.
- Add deterministic tests before changing simulation behavior.
- Do not equate flush with commit, ECS RUNNING with batch success, or Tasklet FINISHED with process exit code 0.
- Run `npm test`, `npm run typecheck`, and `npm run build` before handoff.
- Inspect visible changes in a browser at desktop and mobile sizes.
- Use Conventional Commits. Do not amend or force-push unless explicitly requested.
