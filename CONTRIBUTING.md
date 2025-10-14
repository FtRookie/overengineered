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

## Reporting Issues

Utilize GitHub Issues to report bugs or suggest features.

## Code of Conduct

Maintain respectful and constructive communication.

