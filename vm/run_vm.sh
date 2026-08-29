#!/usr/bin/env bash
# Boot the disposable guest: a qcow2 overlay on the read-only golden image, under
# KVM, with a vhost-vsock channel to the host and NO network device at all. The
# guest's only path off-box is vsock to the host gateway (CID 2). All guest writes
# land in the throwaway overlay; the golden base is never touched.
#
# This is the proven aarch64/KVM invocation from the old sandbox layer with the
# tap NIC removed and `-device vhost-vsock-pci` added. Normally launched by
# backend/vm/lifecycle.py (app-owned subprocess); runnable by hand for a boot test.
set -euo pipefail

VM_DIR="${VM_DIR:-$HOME/jarvis/data/vm}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${JARVIS_VM_BASE:-base-v1.qcow2}"
MEM_MB="${JARVIS_VM_MEM_MB:-768}"
CPUS="${JARVIS_VM_CPUS:-2}"
CID="${JARVIS_VM_CID:-3}"          # guest CID (>=3); host is always CID 2
# Per-guest runtime files and NIC identity. Every default is guest 0's old
# literal, so `bash vm/run_vm.sh` by hand boots exactly the guest it always did.
# lifecycle.py passes all of these; nothing here may go back to hardcoding one,
# which is how JARVIS_VM_TAP came to be exported by the host, honoured by
# net_up.sh, and ignored right here.
OVERLAY="${JARVIS_VM_OVERLAY:-overlay.qcow2}"
EFI_VARS="${JARVIS_VM_EFI_VARS:-efi_vars_run.fd}"
CONSOLE="${JARVIS_VM_CONSOLE:-console.log}"
TAP="${JARVIS_VM_TAP:-jvtap0}"
MAC="${JARVIS_VM_MAC:-52:54:00:12:34:60}"

# Arch, firmware and the qemu binary per host, not hardcoded to the Pi's
# aarch64/AAVMF. lifecycle.py runs this with stdout AND stderr on /dev/null, so
# anything that fails here fails silently from the app's point of view — hence
# the explicit checks below rather than letting qemu error out on its own.
# shellcheck source=vm/platform.sh
. "$SCRIPT_DIR/platform.sh"
jarvis_platform_detect || exit 1

cd "$VM_DIR"
[[ -f "$BASE" ]] || { echo "no $BASE — run build_base.sh first" >&2; exit 1; }

# Refuse a foreign-arch image rather than booting a black box. The marker is
# written by build_base.sh; images predating it are assumed native and pass.
ARCH_MARKER="${BASE%.qcow2}.arch"
if [[ -f "$ARCH_MARKER" ]]; then
  built_for="$(cat "$ARCH_MARKER")"
  [[ "$built_for" == "$VM_ARCH" ]] || {
    echo "$BASE was built for $built_for but this host is $VM_ARCH." >&2
    echo "The golden image is not portable across architectures — rebuild it:" >&2
    echo "  rm -f $VM_DIR/$BASE $VM_DIR/$ARCH_MARKER && bash vm/build_base.sh" >&2
    exit 1; }
fi

[[ -f "$OVERLAY" ]] || qemu-img create -f qcow2 -b "$BASE" -F qcow2 "$OVERLAY" >/dev/null
cp "$FW_VARS" "$EFI_VARS"         # fresh UEFI vars every boot (disposable)

# Network device: netless by default (vsock-only). When JARVIS_VM_EGRESS=1 the
# guest gets a tap NIC bridged to the host, where nftables + the egress proxy
# monitor and broker every byte (A1). The tap ($TAP, default jvtap0) must
# pre-exist — net_up.sh creates it owned by this user before we boot, so
# rootless QEMU can open it.
if [[ "${JARVIS_VM_EGRESS:-0}" == "1" ]]; then
  ip link show "$TAP" >/dev/null 2>&1 || { echo "$TAP missing — net_up.sh must run first" >&2; exit 1; }
  NETDEV=(-netdev "tap,id=n0,ifname=$TAP,script=no,downscript=no"
          -device "virtio-net-pci,netdev=n0,mac=$MAC")
else
  NETDEV=(-nic none)
fi

exec "$QEMU_BIN" \
  "${QEMU_MACHINE[@]}" \
  -smp "$CPUS" -m "$MEM_MB" \
  "${NETDEV[@]}" \
  -drive if=pflash,format=raw,readonly=on,file="$FW_CODE" \
  -drive if=pflash,format=raw,file="$EFI_VARS" \
  -drive "file=$OVERLAY,if=virtio,format=qcow2" \
  -device vhost-vsock-pci,guest-cid="$CID" \
  -device virtio-rng-pci \
  -display none -serial "file:$CONSOLE"
