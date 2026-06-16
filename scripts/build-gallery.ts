#!/usr/bin/env node
import { runBuildGalleryCommand } from "../src/commands/buildGalleryCommand.js";
process.exitCode = await runBuildGalleryCommand(process.argv.slice(2));
