#!/usr/bin/env bash
# Superseded by scripts/install.sh — kept as a shim so anything that still calls
# this name keeps working.
#
# The original was apt-only, sudo-only and hardcoded to the Pi's aarch64 guest.
# All three assumptions broke the moment a second host came into play, and the
# failure surfaced as a wall of apt errors rather than "this box is not Debian".
# install.sh detects the distro and architecture, and separates the steps that
# need root from the ones that do not so a no-sudo host can still get to a
# working install.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "note: setup_pi.sh is now a shim for install.sh — see README" >&2
exec bash "$DIR/install.sh" "$@"
