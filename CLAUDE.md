# ECSBatchCity engineering rules

`IMPLEMENTATION_BRIEF.md` is the source of truth for domain behavior, architecture, terminology, scenarios, and delivery.

The simulation is a deterministic teaching model, not an AWS emulator. Every visible status, metric, flow, and explanation must derive from the same tested simulation state. Presentation code does not mutate simulation state directly.

Use Vue for DOM UI, Pinia for orchestration and snapshots, pure TypeScript for simulation, Three.js for 3D presentation, and Tailwind CSS for DOM styling. Never store Three.js objects in Pinia.

Use red/green TDD for behavior changes. Preserve the distinctions between framework status, application result, JVM process exit, container exit code, and ECS stop metadata.
