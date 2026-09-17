#!/usr/bin/env bash
set -euo pipefail

: "${FAMILY:?Missing FAMILY}"
: "${ARCH:?Missing ARCH}"
: "${TARGET:?Missing TARGET}"
: "${RELEASE_TAG:?Missing RELEASE_TAG}"
: "${GH_REPO:?Missing GH_REPO}"
version=${RELEASE_TAG#v}

# Cargo writes workspace builds to the repository's target directory.
# Keep crate-local fallbacks for builds with a custom CARGO_TARGET_DIR.
bundle_roots=(
  "target/${TARGET}/release/bundle"
  "target/release/bundle"
  "apps/desktop/src-tauri/target/${TARGET}/release/bundle"
  "apps/desktop/src-tauri/target/release/bundle"
)
uploads=()

stage_alias() {
  local subdir=$1 source_name=$2 alias_name=$3 root
  for root in "${bundle_roots[@]}"; do
    if [ -s "$root/$subdir/$source_name" ]; then
      cp "$root/$subdir/$source_name" "$alias_name"
      uploads+=("$alias_name")
      return
    fi
  done
  echo "::error::Missing required ${FAMILY}/${ARCH} bundle: $subdir/$source_name" >&2
  return 1
}

case "$FAMILY/$ARCH" in
  linux/amd64|linux/arm64)
    if [ "$ARCH" = amd64 ]; then
      rpm_arch=x86_64
      appimage_arch=amd64
    else
      rpm_arch=aarch64
      appimage_arch=aarch64
    fi
    stage_alias deb "RunHQ_${version}_${ARCH}.deb" "runhq_${ARCH}.deb"
    stage_alias rpm "RunHQ-${version}-1.${rpm_arch}.rpm" "runhq_${ARCH}.rpm"
    stage_alias appimage "RunHQ_${version}_${appimage_arch}.AppImage" "runhq_${ARCH}.AppImage"
    ;;
  windows/x64|windows/arm64)
    # Both NSIS and the default en-US WiX package are required on both
    # architectures; tauri.conf.json enables all bundle targets.
    stage_alias nsis "RunHQ_${version}_${ARCH}-setup.exe" "runhq_${ARCH}-setup.exe"
    stage_alias msi "RunHQ_${version}_${ARCH}_en-US.msi" "runhq_${ARCH}.msi"
    ;;
  macos/aarch64|macos/x64)
    stage_alias dmg "RunHQ_${version}_${ARCH}.dmg" "runhq_${ARCH}.dmg"
    ;;
  *)
    echo "::error::Unsupported release platform: $FAMILY/$ARCH" >&2
    exit 1
    ;;
esac

# Upload only after every expected format is found. Exact versioned names
# avoid copying a previous release left in a restored build cache.
gh release upload "$RELEASE_TAG" "${uploads[@]}" --clobber --repo "$GH_REPO"
