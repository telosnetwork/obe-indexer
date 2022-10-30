const {resolve} = require("path");

module.exports = {
    root: true,
    parserOptions: {
        parser: "@typescript-eslint/parser",
        project: resolve(__dirname, "./tsconfig.json"),
        tsconfigRootDir: __dirname,
        ecmaVersion: 2018, // Allows for the parsing of modern ECMAScript features
        sourceType: "module", // Allows for the use of imports
    },
    plugins: ["@typescript-eslint"],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
    ],
    rules: {
        "prettier/prettier": "warn",
    },
};
