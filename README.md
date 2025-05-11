# MDRF Converter Library (v3.0)

## 概要

`MDRF Converter Library` は、Markdown Diff Review Format (MDRF) v3.0 仕様に基づいて記述されたマークダウンファイルのパース（解析）とジェネレート（生成）を行うための統合JavaScriptライブラリです。ブラウザ環境での動作を想定しています。

このライブラリは、以下の主要な機能を提供します。

* MDRF v3.0形式のMarkdown文字列をJavaScriptオブジェクトに変換します。
* MDRF v3.0形式のMarkdown文字列をYAML文字列に変換します。
* 特定のスキーマに準拠したJavaScriptオブジェクトからMDRF v3.0形式のMarkdown文字列を生成します。
* 特定のスキーマに準拠したYAML文字列からMDRF v3.0形式のMarkdown文字列を生成します。
* MDRF生成時にスレッド番号とコメントIDを自動採番するオプションを提供します。

## 依存ライブラリ

このライブラリは、YAMLの処理（パースとダンプ）に `js-yaml` ライブラリを使用します。このライブラリを使用するHTMLファイルで、事前に `js-yaml` を読み込んでおく必要があります。

```html
<script src="[https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js](https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js)"></script>
```

## ファイル構成

* `mdrf-converter.js`: ライブラリ本体のJavaScriptファイル。
* `index.html` (または同様のHTMLファイル): ライブラリの使用例を示すサンプルページ。
* `README.md`: このファイル。

## セットアップ

1.  `js-yaml` ライブラリをHTMLファイルにインクルードします。
2.  `mdrf-converter.js` をHTMLファイルにインクルードします。

```html
<script src="[https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js](https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js)"></script>
<script src="mdrf-converter.js"></script>
```

## 使用方法

### 1. コンバータのインスタンス化

```javascript
// デフォルトオプションでインスタンス化
const converter = new MdrfConverter();

// オプションを指定してインスタンス化
const converterWithOptions = new MdrfConverter({
    yamlIndent: 4,       // YAML出力時のインデント数 (デフォルト: 2)
    autoNumbering: true  // MDRF生成時の自動採番 (デフォルト: false)
});
```js-yaml` が読み込まれていない場合、インスタンス化時にエラーがスローされます。

### 2. MDRFコンテンツのパース

#### 2.1. MDRF文字列をJavaScriptオブジェクトにパース

```javascript
const mdrfString = `
# Sample Review
---
mdrf_version: 3.0
---
## Group: G1
### file.txt
**Diff:**
\`\`\`diff
-old
+new
\`\`\`
`;

try {
    const mdrfObject = converter.parseToObject(mdrfString);
    console.log("Parsed MDRF Object:", mdrfObject);
} catch (error) {
    console.error("Error parsing MDRF to Object:", error);
}
```

#### 2.2. MDRF文字列をYAML文字列に直接パース

```javascript
try {
    const yamlOutput = converter.parseToYaml(mdrfString);
    console.log("Parsed YAML Output:\n", yamlOutput);
} catch (error) {
    console.error("Error parsing MDRF to YAML:", error);
}
```

### 3. MDRFコンテンツの生成

入力オブジェクトは、`MdrfParser` が出力するオブジェクトのスキーマ（または `mdrf_output_json_schema.json` で定義されるスキーマ）に準拠している必要があります。

#### 3.1. JavaScriptオブジェクトからMDRF文字列を生成

```javascript
const mdrfObjectToGenerate = {
  title: "Generated MDRF Document",
  front_matter: { mdrf_version: "3.0", project: "My Gen Project" },
  groups: [
    {
      type: "Feature", name_id: "FEAT-123",
      files: [
        {
          path: "src/app.js", status: "modified",
          diff: "--- a/src/app.js\n+++ b/src/app.js\n@@ -1 +1 @@\n-console.log(1);\n+console.log(2);",
          threads: [
            {
              // thread_number: 1, // 自動採番が有効なら不要
              line_number: 1,
              comments: [
                { /* id: "1.1", */ username: "user1", timestamp: new Date().toISOString(), body: "First comment." },
                { /* id: "1.2", */ username: "user2", timestamp: new Date().toISOString(), body: "Second comment." }
              ]
            }
          ]
        }
      ]
    }
  ]
};

try {
    // インスタンス化時のオプションを使用
    const mdrfMarkdown1 = converterWithOptions.generateFromObject(mdrfObjectToGenerate);
    console.log("Generated MDRF (with instance options):\n", mdrfMarkdown1);

    // メソッド呼び出し時にオプションを上書き (自動採番を無効化)
    const mdrfMarkdown2 = converter.generateFromObject(mdrfObjectToGenerate, { autoNumbering: false });
    console.log("Generated MDRF (autoNumbering disabled):\n", mdrfMarkdown2);

} catch (error) {
    console.error("Error generating MDRF from Object:", error);
}
```

#### 3.2. YAML文字列からMDRF文字列を生成

```javascript
const yamlInputString = `
title: MDRF from YAML
front_matter:
  mdrf_version: '3.0'
  project: Project From YAML
groups:
  - type: TestGroup
    name_id: TG1
    files:
      - path: test.txt
        status: added
        diff: "+++ b/test.txt\\n@@ -0,0 +1 @@\\n+Hello"
        threads: []
`;

try {
    // インスタンス化時のオプション (autoNumbering: true) を使用
    const mdrfMarkdown1 = converterWithOptions.generateFromYaml(yamlInputString);
    console.log("Generated MDRF from YAML (with instance options):\n", mdrfMarkdown1);
    
    // メソッド呼び出し時にオプションを上書き
    const mdrfMarkdown2 = converter.generateFromYaml(yamlInputString, { autoNumbering: false });
    console.log("Generated MDRF from YAML (autoNumbering disabled):\n", mdrfMarkdown2);
} catch (error) {
    console.error("Error generating MDRF from YAML:", error);
}
```

### 4. 自動採番機能 (`autoNumbering` オプション)

MDRF生成時（`generateFromObject` または `generateFromYaml` メソッド呼び出し時）に `autoNumbering: true` オプションを指定すると、以下のIDが自動的に採番・上書きされます。

* **スレッド番号 (`thread_number`)**: 各ファイル内で `1` から始まる連番。
* **コメントID (`id`)**: 各スレッド内で `スレッド番号.コメント連番` (例: `1.1`, `1.2`, `2.1`) の形式。

このオプションは、コンストラクタでデフォルトとして設定することも、各生成メソッド呼び出し時に個別に指定することも可能です。メソッド呼び出し時のオプションが優先されます。

## `MdrfConverter` クラスの主要メソッド

* **`constructor(options = {})`**:
    * コンバータを初期化します。
    * `options.yamlIndent` (number, デフォルト: 2): YAMLをダンプ/生成する際のインデント数。
    * `options.autoNumbering` (boolean, デフォルト: false): MDRF生成時にスレッド番号とコメントIDを自動採番するかどうか。
* **`parseToObject(mdrfString)`**:
    * MDRF v3.0形式の文字列をJavaScriptオブジェクトにパースします。
* **`parseToYaml(mdrfString)`**:
    * MDRF v3.0形式の文字列をYAML形式の文字列にパースします。
* **`generateFromObject(mdrfObject, methodOptions = {})`**:
    * JavaScriptオブジェクトからMDRF v3.0形式のMarkdown文字列を生成します。
    * `methodOptions` でコンストラクタオプションを上書き可能。
* **`generateFromYaml(yamlString, methodOptions = {})`**:
    * YAML文字列からMDRF v3.0形式のMarkdown文字列を生成します。
    * `methodOptions` でコンストラクタオプションを上書き可能。

## MDRF v3.0仕様への準拠

* **パーサー**: MDRF v3.0仕様で定義された厳密な階層構造、YAML Front Matter、各ヘッダー、メタデータブロック、Diffブロック、コメント形式を解釈します。
* **ジェネレーター**: 入力データから、MDRF v3.0仕様に準拠したMarkdown文字列を生成します。

## 注意事項

* **ジェネレーターの入力**: ジェネレーター機能は、入力されるJavaScriptオブジェクトまたはYAML文字列が、パーサーの出力スキーマ（`mdrf_output_json_schema.json` で定義されるような構造）に準拠していることを前提としています。
* **文字列のエスケープ**: ジェネレーター機能では、入力内の文字列（タイトル、パス、コメント本文、Diff内容など）は基本的にそのままMarkdownに出力されます。
* **パフォーマンス**: 非常に大きなMDRFファイルに対するパフォーマンスは、実行環境やファイルサイズによって変動する可能性があります。

## 開発とテスト

サンプルHTMLファイル (`index.html`) を使用して、ブラウザ上でライブラリの基本的な動作確認やテストを行うことができます。

## ライセンス

このライブラリは [Unlicense](https://unlicense.org/) の下で提供されます。

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org/>
```

## 謝辞

このライブラリの初期バージョンは、Google の Gemini 2.5 Pro によって作成されました。
