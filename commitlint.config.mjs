/**
 * Commitlint 配置 —— 强制 Conventional Commits。
 * 与 husky 的 commit-msg hook 配合，提交信息不符合规范时阻断提交。
 * 类型参考：feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 允许正文为空，但必须带 scope 或 type（默认要求）
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "subject-case": [0],
    "footer-max-line-length": [0],
  },
};
