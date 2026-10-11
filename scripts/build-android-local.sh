#!/usr/bin/env bash
# Local, account-free Android release build (no EAS, no Google account).
#
# Intended to run inside a container with JDK 17, Node 22, Android SDK 36,
# build-tools 36.0.0 and NDK 27.1.12297006 (ANDROID_HOME set).
#
#   scripts/build-android-local.sh <keystore-dir> <output-apk>
#
# The keystore is generated in <keystore-dir> if it does not exist. Keep that
# directory OUTSIDE the repository. The APK is signed with that key, so reuse the
# same directory for every build or Android will refuse to install over the top.
set -euo pipefail

KEYSTORE_DIR="${1:?keystore directory}"
OUT_APK="${2:?output apk path}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p "$KEYSTORE_DIR"
KS="$KEYSTORE_DIR/jarvis-local.jks"
PASS_FILE="$KEYSTORE_DIR/keystore.pass"
if [ ! -f "$KS" ]; then
  head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
  keytool -genkeypair -v -keystore "$KS" -alias jarvis -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$(cat "$PASS_FILE")" -keypass "$(cat "$PASS_FILE")" \
    -dname "CN=Jarvis Local Build, O=Local, C=AU"
fi

npm ci --no-audit --no-fund
npx expo prebuild --platform android --clean --no-install

# Enable abiFilters-free release signing from the local keystore via gradle.properties.
cat >> android/gradle.properties <<PROPS

JARVIS_KEYSTORE=$KS
JARVIS_KEYSTORE_PASSWORD=$(cat "$PASS_FILE")
JARVIS_KEY_ALIAS=jarvis
PROPS

# Point the release build type at the local keystore (replaces the debug key).
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("android/app/build.gradle")
s = p.read_text()
signing = """    signingConfigs {
        release {
            storeFile file(JARVIS_KEYSTORE)
            storePassword JARVIS_KEYSTORE_PASSWORD
            keyAlias JARVIS_KEY_ALIAS
            keyPassword JARVIS_KEYSTORE_PASSWORD
        }
"""
s, n = re.subn(r"    signingConfigs \{\n", signing, s, count=1)
assert n == 1, "signingConfigs block not found"
# release buildType: swap the debug signing config for the release one
m = re.search(r"buildTypes \{.*?release \{(.*?)\n        \}", s, re.S)
assert m, "release buildType not found"
block = m.group(0).replace("signingConfig signingConfigs.debug", "signingConfig signingConfigs.release")
s = s.replace(m.group(0), block)
p.write_text(s)
PY

( cd android && ./gradlew --no-daemon assembleRelease -PreactNativeArchitectures=arm64-v8a )

APK="$(ls android/app/build/outputs/apk/release/*.apk | head -n1)"
mkdir -p "$(dirname "$OUT_APK")"
cp "$APK" "$OUT_APK"
echo "APK: $OUT_APK"
