#!/usr/bin/env bash
set -euo pipefail

REPO="modu/mobi"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="mobi"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# 检测平台
detect_platform() {
    local os cpu
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    cpu="$(uname -m)"

    case "$os" in
        darwin) os="darwin" ;;
        linux)  os="linux" ;;
        *)      error "Unsupported OS: $os" ;;
    esac

    case "$cpu" in
        x86_64|amd64)   cpu="x64" ;;
        arm64|aarch64)  cpu="arm64" ;;
        *)              error "Unsupported CPU: $cpu" ;;
    esac

    echo "mobi-${os}-${cpu}"
}

# 获取最新版本
get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases" \
        | grep -o '"tag_name": *"[^"]*"' \
        | grep -v '\-rc' \
        | head -1 \
        | sed 's/.*"v/v/' \
        | sed 's/".*//' \
        | sed 's/^v//'
}

# 下载文件
download() {
    local url="$1"
    local dest="$2"

    if command -v curl &>/dev/null; then
        curl -fsSL -o "$dest" "$url"
    elif command -v wget &>/dev/null; then
        wget -q -O "$dest" "$url"
    else
        error "Neither curl nor wget found. Please install one."
    fi
}

# 主流程
main() {
    info "Installing mobi..."

    local platform
    platform="$(detect_platform)"
    info "Detected platform: ${platform}"

    local version
    version="$(get_latest_version)"
    if [ -z "$version" ]; then
        error "Failed to determine latest version"
    fi
    info "Latest version: v${version}"

    # 检查已安装的版本
    local installed_bin="${INSTALL_DIR}/${BINARY_NAME}"
    if [ -x "$installed_bin" ]; then
        local installed_version
        installed_version="$("$installed_bin" version 2>/dev/null | head -1 | sed 's/^v//')"
        if [ -n "$installed_version" ] && [ "$installed_version" = "$version" ]; then
            info "mobi v${version} is already installed"
            exit 0
        fi
        if [ -n "$installed_version" ]; then
            info "Upgrading mobi v${installed_version} → v${version}..."
            exec "$installed_bin" upgrade --yes
        fi
    fi

    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir"' EXIT

    local base_url="https://github.com/${REPO}/releases/download/v${version}"
    local binary_file="${platform}.zip"
    local checksums_file="checksums.txt"

    info "Downloading ${binary_file}..."
    download "${base_url}/${binary_file}" "${tmp_dir}/${binary_file}"

    info "Downloading checksums..."
    download "${base_url}/${checksums_file}" "${tmp_dir}/${checksums_file}"

    info "Verifying checksum..."
    local expected_hash
    expected_hash="$(grep "  ${binary_file}$" "${tmp_dir}/${checksums_file}" | awk '{print $1}')"
    if [ -z "$expected_hash" ]; then
        error "No checksum found for ${binary_file}"
    fi

    local actual_hash
    if command -v sha256sum &>/dev/null; then
        actual_hash="$(sha256sum "${tmp_dir}/${binary_file}" | awk '{print $1}')"
    elif command -v shasum &>/dev/null; then
        actual_hash="$(shasum -a 256 "${tmp_dir}/${binary_file}" | awk '{print $1}')"
    else
        error "Neither sha256sum nor shasum found"
    fi

    if [ "$expected_hash" != "$actual_hash" ]; then
        error "Checksum mismatch!\nExpected: ${expected_hash}\nActual:   ${actual_hash}"
    fi

    local binary_path="${tmp_dir}/${BINARY_NAME}"
    if [[ "$binary_file" == *.zip ]]; then
        if command -v unzip &>/dev/null; then
            unzip -o -q "${tmp_dir}/${binary_file}" -d "${tmp_dir}"
        else
            error "unzip not found. Please install unzip."
        fi
    else
        mv "${tmp_dir}/${binary_file}" "${binary_path}"
    fi
    chmod +x "${binary_path}"

    mkdir -p "${INSTALL_DIR}"
    mv "${binary_path}" "${INSTALL_DIR}/${BINARY_NAME}"
    info "Installed to ${INSTALL_DIR}/${BINARY_NAME}"

    local shell_rc=""
    if [ -n "${ZSH_VERSION:-}" ]; then
        shell_rc="$HOME/.zshrc"
    elif [ -n "${BASH_VERSION:-}" ]; then
        shell_rc="$HOME/.bashrc"
    fi

    if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
        if ! grep -q '\.local/bin' "$shell_rc" 2>/dev/null; then
            echo '' >> "$shell_rc"
            echo '# Added by mobi install script' >> "$shell_rc"
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$shell_rc"
            info "Added ~/.local/bin to ${shell_rc}"
            warn "Run 'source ${shell_rc}' or open a new terminal to use mobi"
        fi
    fi

    if "${INSTALL_DIR}/${BINARY_NAME}" version &>/dev/null; then
        local installed_version
        installed_version="$("${INSTALL_DIR}/${BINARY_NAME}" version)"
        info "Successfully installed mobi ${installed_version}"
    else
        warn "Installation completed but verification failed"
        warn "Make sure ${INSTALL_DIR} is in your PATH"
    fi
}

main "$@"
