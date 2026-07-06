# ndrstnd Homebrew formula.
#
# This repository doubles as a Homebrew tap, so users install with:
#
#   brew tap truizlop/ndrstnd https://github.com/truizlop/ndrstnd
#   brew install ndrstnd
#
# Cutting a release:
#   1. Tag it:            git tag v0.1.0 && git push origin v0.1.0
#   2. Compute the hash:  curl -L https://github.com/truizlop/ndrstnd/archive/refs/tags/v0.1.0.tar.gz | shasum -a 256
#   3. Replace the sha256 placeholder below, then commit and push.
#
# Until the first tag exists, only `brew install --HEAD ndrstnd` works.
class Ndrstnd < Formula
  desc "Comprehension workspace for large, agent-produced branch changes"
  homepage "https://truizlop.github.io/ndrstnd/"
  url "https://github.com/truizlop/ndrstnd/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "REPLACE_WITH_RELEASE_TARBALL_SHA256"
  license "Apache-2.0"
  head "https://github.com/truizlop/ndrstnd.git", branch: "main"

  depends_on "node"

  def install
    # Dev dependencies are needed for the TypeScript build; the second
    # install packs the built package (dist/ plus skill assets) into libexec.
    system "npm", "install", "--no-audit", "--no-fund"
    system "npm", "run", "build"
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "understand agent-produced branch changes", shell_output("#{bin}/ndrstnd --help")
  end
end
