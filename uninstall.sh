#!/usr/bin/env bash
set -euo pipefail
code --uninstall-extension local.gvim-marker-folds
printf 'Remove only this feature’s config entries; preserve unrelated user settings.\n'
