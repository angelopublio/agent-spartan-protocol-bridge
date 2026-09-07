#!/bin/sh

set -eu

usage() {
  echo "usage: manage-install.sh <install|uninstall> <agents|claude|all>" >&2
  exit 2
}

action=${1:-}
host_group=${2:-}

case "$action" in
  install|uninstall) ;;
  *) usage ;;
esac

case "$host_group" in
  agents|claude|all) ;;
  *) usage ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
package_root=$(dirname -- "$script_dir")
skill_source="$package_root/skills/spbridge"
install_home=${SPBRIDGE_INSTALL_HOME:-$HOME}

if [ ! -f "$skill_source/SKILL.md" ]; then
  echo "spbridge skill source not found: $skill_source" >&2
  exit 1
fi

install_link() {
  destination=$1
  parent=$(dirname -- "$destination")
  mkdir -p "$parent"

  if [ -e "$destination" ] || [ -L "$destination" ]; then
    if [ ! -L "$destination" ]; then
      echo "refusing to replace non-symlink: $destination" >&2
      exit 1
    fi
    current_target=$(readlink "$destination")
    if [ "$current_target" = "$skill_source" ]; then
      echo "already installed: $destination"
      return
    fi
    echo "migrating spbridge link: $destination"
    unlink "$destination"
  fi

  ln -s "$skill_source" "$destination"
  test -f "$destination/SKILL.md"
  echo "installed: $destination -> $skill_source"
}

uninstall_link() {
  destination=$1
  if [ ! -e "$destination" ] && [ ! -L "$destination" ]; then
    echo "not installed: $destination"
    return
  fi
  if [ ! -L "$destination" ]; then
    echo "refusing to remove non-symlink: $destination" >&2
    exit 1
  fi
  current_target=$(readlink "$destination")
  if [ "$current_target" != "$skill_source" ]; then
    echo "refusing to remove a link owned by another source: $destination" >&2
    exit 1
  fi
  unlink "$destination"
  echo "uninstalled: $destination"
}

manage_link() {
  destination=$1
  if [ "$action" = "install" ]; then
    install_link "$destination"
  else
    uninstall_link "$destination"
  fi
}

case "$host_group" in
  agents)
    manage_link "$install_home/.agents/skills/spbridge"
    ;;
  claude)
    manage_link "$install_home/.claude/skills/spbridge"
    ;;
  all)
    manage_link "$install_home/.agents/skills/spbridge"
    manage_link "$install_home/.claude/skills/spbridge"
    ;;
esac
