# Contributing

We appreciate your interest in contributing. This document provides guidelines for contributing to the project.

## CLI

- `npm i` - Install node libraries
- `lune list` - List of available toolchain scripts
- `lune run assemble` - Build a place.rbxl file to work with
- `lune run savechanges` - Save changed assets from place.rbxl, not needed when place file assets watcher is running

### Development

- `npm run dev` - Runs all watchers
- `npm run watch` - Runs only roblox-ts compiler
- `npm run rojo` - Runs only rojo
- `node ./scripts/lunewatch.js` - Runs only place file assets watcher

## Development Workflow

- Ensure your code adheres to the project's style guidelines (ESLint and Prettier are utilized).
- Thoroughly test your changes.
- Execute `npm run build` to verify compilation.

## Pull Request Process

1. Implement your changes and test them.
2. Commit your changes with clear, descriptive messages.
3. Push your changes and create a Pull Request.
4. Await review.

## What PRs will never be accepted

- Systems for transferring/sharing slots
- "Unrealistic" or game-breaking changes, such as switchable anchors
- Trivial changes to comments

Note: There is a distinction between our proprietary database version and the public GitHub version. Slot limitations differ significantly; our database accommodates up to 16 megabytes of data, while Roblox's conventional method is restricted to 4 megabytes. This disparity influences capacity and may pose current challenges.

## Contributor Licensing

By opening a pull request you choose how your contribution is licensed. Say which option you want in the pull
request description. **If you say nothing, Option B applies.**

**Option A — keep it open.**
Your contribution is licensed under the Apache License 2.0, the same terms as the upstream project. Anyone may
use it, including other forks of OverEngineered.

**Option B — project licensed (default).**
Your contribution is licensed to this project under the terms in [LICENSE](LICENSE), and the maintainer decides
whether and how it may be used elsewhere.

Under either option you keep the copyright to what you wrote. You also confirm that you wrote it, that you are
entitled to submit it, and that no employer, client or other licence has a claim on it.

**What Option B does not do.** This project is a fork of an Apache 2.0 work. Option B covers the new material in
your contribution and nothing else — the upstream code your patch sits alongside remains under Apache 2.0 for
everyone. Choosing Option B does not withdraw that grant, and any fork may still take the upstream base.

## Reporting Issues

Utilize GitHub Issues to report bugs or suggest features.

## Code of Conduct

Maintain respectful and constructive communication.

