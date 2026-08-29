#!/usr/bin/env bash
# Host-platform detection for the sandbox VM. Sourced by build_base.sh and
# run_vm.sh; never executed directly.
#
# The guest was born on an arm64 Pi and every qemu invocation was hardcoded to
# aarch64 + Debian's AAVMF firmware paths. That is three separate assumptions
# (CPU arch, cloud-image flavour, distro firmware layout) and moving the host
# breaks all three at once, in a subprocess whose stderr goes to /dev/null. So
# they are resolved here, once, loudly.
#
# Sets, for the caller:
#   VM_ARCH        aarch64 | x86_64      (host arch; the guest matches it)
#   DEB_ARCH       arm64   | amd64       (Debian cloud-image flavour)
#   QEMU_BIN       qemu-system-<arch>
#   QEMU_MACHINE   array: the -machine/-accel/-cpu flags for this arch
#   FW_CODE        read-only UEFI firmware blob (pflash 0)
#   FW_VARS        writable UEFI vars template (pflash 1)
#
# Firmware is looked up across Debian/Ubuntu, Arch and Fedora layouts because
# the point of this file is that the next host is not the last one. CODE and
# VARS must come from the SAME pack — a 4 MB OVMF_CODE with a 2 MB VARS boots
# to a black screen with no error, which is a miserable thing to debug.

# No `set -e` here: this file is sourced, and killing the caller's shell from a
# sourced helper hides the actual message. Callers check the return code.

jarvis_platform_detect() {
  VM_ARCH="$(uname -m)"
  case "$VM_ARCH" in
    aarch64|arm64) VM_ARCH=aarch64; DEB_ARCH=arm64 ;;
    x86_64|amd64)  VM_ARCH=x86_64;  DEB_ARCH=amd64 ;;
    *)
      echo "unsupported host architecture: $VM_ARCH" >&2
      echo "the guest image is built for the host's own arch (no emulation —" >&2
      echo "the loop needs KVM), so only aarch64 and x86_64 are supported." >&2
      return 1 ;;
  esac

  QEMU_BIN="qemu-system-${VM_ARCH}"

  if [ "$VM_ARCH" = aarch64 ]; then
    # gic-version=host requires KVM; it is what the Pi has always used.
    QEMU_MACHINE=(-machine virt,gic-version=host -accel kvm -cpu host)
  else
    QEMU_MACHINE=(-machine q35,accel=kvm -cpu host)
  fi

  jarvis_platform_firmware || return 1
  return 0
}

# Find a matching (CODE, VARS) UEFI firmware pair. Candidates are listed as
# "code:vars" so the two can never be mixed across packs.
jarvis_platform_firmware() {
  local candidates=() pair code vars

  # Explicit override, for a distro whose layout is not below (NixOS, a hand-
  # built edk2) — and the seam that makes this resolver testable at all.
  if [ -n "${JARVIS_FW_CODE:-}" ] || [ -n "${JARVIS_FW_VARS:-}" ]; then
    [ -r "${JARVIS_FW_CODE:-}" ] || { echo "JARVIS_FW_CODE not readable: ${JARVIS_FW_CODE:-unset}" >&2; return 1; }
    [ -r "${JARVIS_FW_VARS:-}" ] || { echo "JARVIS_FW_VARS not readable: ${JARVIS_FW_VARS:-unset}" >&2; return 1; }
    FW_CODE="$JARVIS_FW_CODE"
    FW_VARS="$JARVIS_FW_VARS"
    return 0
  fi

  if [ "$VM_ARCH" = aarch64 ]; then
    candidates=(
      # Debian/Ubuntu: qemu-efi-aarch64
      "/usr/share/AAVMF/AAVMF_CODE.fd:/usr/share/AAVMF/AAVMF_VARS.fd"
      # Arch: edk2-aarch64
      "/usr/share/edk2/aarch64/QEMU_EFI.fd:/usr/share/edk2/aarch64/vars-template-pflash.raw"
      "/usr/share/edk2/aarch64/QEMU_CODE.fd:/usr/share/edk2/aarch64/QEMU_VARS.fd"
      # Fedora: edk2-aarch64
      "/usr/share/edk2/aarch64/QEMU_EFI-pflash.raw:/usr/share/edk2/aarch64/vars-template-pflash.raw"
    )
  else
    candidates=(
      # Debian/Ubuntu, 4 MB build (current default) then the older 2 MB one
      "/usr/share/OVMF/OVMF_CODE_4M.fd:/usr/share/OVMF/OVMF_VARS_4M.fd"
      "/usr/share/OVMF/OVMF_CODE.fd:/usr/share/OVMF/OVMF_VARS.fd"
      # Arch: edk2-ovmf
      "/usr/share/edk2/x64/OVMF_CODE.4m.fd:/usr/share/edk2/x64/OVMF_VARS.4m.fd"
      "/usr/share/edk2/x64/OVMF_CODE.fd:/usr/share/edk2/x64/OVMF_VARS.fd"
      # Fedora
      "/usr/share/edk2/ovmf/OVMF_CODE.fd:/usr/share/edk2/ovmf/OVMF_VARS.fd"
    )
  fi

  for pair in "${candidates[@]}"; do
    code="${pair%%:*}"
    vars="${pair##*:}"
    if [ -r "$code" ] && [ -r "$vars" ]; then
      FW_CODE="$code"
      FW_VARS="$vars"
      return 0
    fi
  done

  echo "no UEFI firmware pair found for $VM_ARCH. Looked for:" >&2
  printf '  %s\n' "${candidates[@]}" >&2
  if [ "$VM_ARCH" = aarch64 ]; then
    echo "install it:  apt install qemu-efi-aarch64   |   pacman -S edk2-aarch64" >&2
  else
    echo "install it:  apt install ovmf               |   pacman -S edk2-ovmf" >&2
  fi
  return 1
}

# Build a cloud-init seed ISO from user-data + meta-data in the cwd.
#
# cloud-localds (cloud-image-utils) is the obvious tool and is what the Pi used,
# but it is not packaged on Arch outside the AUR — which would have made the
# migration target need an AUR helper to install a server. Every one of these
# tools writes the same thing: an ISO9660 filesystem labelled `cidata`. So try
# cloud-localds, then fall back to any mkisofs-alike.
jarvis_make_seed() {
  local out="${1:-seed.iso}"
  if command -v cloud-localds >/dev/null 2>&1; then
    cloud-localds "$out" user-data meta-data
  elif command -v xorriso >/dev/null 2>&1; then
    xorriso -as mkisofs -quiet -output "$out" -volid cidata -joliet -rock \
      user-data meta-data
  elif command -v genisoimage >/dev/null 2>&1; then
    genisoimage -quiet -output "$out" -volid cidata -joliet -rock \
      user-data meta-data
  elif command -v mkisofs >/dev/null 2>&1; then
    mkisofs -quiet -output "$out" -volid cidata -joliet -rock \
      user-data meta-data
  else
    echo "need one of: cloud-localds, xorriso, genisoimage, mkisofs" >&2
    echo "install it:  apt install cloud-image-utils  |  pacman -S libisoburn" >&2
    return 1
  fi
}
