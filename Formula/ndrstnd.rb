# ndrstnd Homebrew formula.
#
# This repository doubles as a Homebrew tap, so users install with:
#
#   brew tap truizlop/ndrstnd https://github.com/truizlop/ndrstnd
#   brew trust truizlop/ndrstnd
#   brew install ndrstnd
#
# Cutting a release (tags are unprefixed, e.g. 0.1.0):
#   1. Tag it:            git tag 0.1.0 && git push origin 0.1.0
#   2. Compute the hash:  curl -L https://github.com/truizlop/ndrstnd/archive/refs/tags/0.1.0.tar.gz | shasum -a 256
#   3. Replace the sha256 below, then commit and push.
#
# Until the first tag exists, only `brew install --HEAD ndrstnd` works.
class Ndrstnd < Formula
  desc "Comprehension workspace for large, agent-produced branch changes"
  homepage "https://truizlop.github.io/ndrstnd/"
  url "https://github.com/truizlop/ndrstnd/archive/refs/tags/0.1.2.tar.gz"
  sha256 "3480ec6f9571fc74a0e05e68c3709ad2af13256a92455ac24f0e043b7f165235"
  license "Apache-2.0"
  head "https://github.com/truizlop/ndrstnd.git", branch: "main"

  depends_on "node"

  def caveats
    data_dir = OS.mac? ? "~/Library/Application Support/ndrstnd" : "$XDG_DATA_HOME/ndrstnd (default ~/.local/share/ndrstnd)"
    <<~EOS
      ndrstnd analyzes with an installed Codex, Claude Code, or Pi CLI and uses
      its authenticated session; it never stores a token itself.

      ndrstnd stores local state under:
        #{data_dir}/ndrstnd.sqlite
      Review artifacts are written to the reviewed repository's Git-ignored
      .ndrstnd/ directory; delete them when the review is done.

      Quick start:
        ndrstnd auth status
        ndrstnd skill install
        ndrstnd review feature/my-change --base main

      Every command accepts --agent codex, --agent claude, or --agent pi.
    EOS
  end

  def install
    # Dev dependencies are needed for the TypeScript build; the second
    # install packs the built package (dist/ plus skill assets) into libexec.
    system "npm", "install", "--no-audit", "--no-fund"
    system "npm", "run", "build"
    # better-sqlite3 is a native dependency; its install script downloads or
    # builds the .node binding required by the packaged CLI.
    system "npm", "install", *std_npm_args(ignore_scripts: false)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "understand agent-produced branch changes", shell_output("#{bin}/ndrstnd --help")
    system "node", "-e", <<~JS, libexec/"lib/node_modules/ndrstnd/node_modules/better-sqlite3"
      const Database = require(process.argv[1]);
      const database = new Database(":memory:");
      database.close();
    JS
  end
end
