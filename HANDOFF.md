# ECSBatchCity handoff

最終更新: 2026-07-31

## 現在地

ECSBatchCityは完成版ではなく、指示書の主要レイヤーを1本につないだ「動作する縦切りMVP」である。

- Repository: <https://github.com/baoo-public-learning/ECSBatchCity>
- GitHub Pages: <https://baoo-public-learning.github.io/ECSBatchCity/>
- MVP commit: `10edcd8 feat: build ECS batch simulator`
- Default branch: `main`

GitHub Pagesのbuildとdeployは成功済み。公開HTML、JavaScript、CSSがHTTP 200を返すことも確認済み。

## 次のセッションの開始手順

1. リポジトリをcloneまたは最新の`main`へ更新する。
2. `AGENTS.md`を読む。
3. `CLAUDE.md`を読む。
4. `IMPLEMENTATION_BRIEF.md`を全文読む。
5. この`HANDOFF.md`を読む。
6. `npm install`を実行する。
7. 変更前に`npm test`、`npm run typecheck`、`npm run build`を実行してbaselineを確認する。

## 実装済み

### アプリケーション基盤

- Vue 3
- Composition APIと`<script setup lang="ts">`
- Pinia
- Tailwind CSS
- Three.js
- Vite
- TypeScript strict mode
- Vitest
- `vue-tsc`
- GitHub Actions CI
- GitHub Pages workflow

### シミュレーション

- `RunTask`
- `StopTask`
- ECS Task lifecycle
  - `PROVISIONING`
  - `PENDING`
  - `ACTIVATING`
  - `RUNNING`
  - `STOPPING`
  - `DEPROVISIONING`
  - `STOPPED`
- `desiredStatus`と実状態の分離
- Fargate / `awsvpc`の簡略モデル
- Java 21 container設定
- Spring Boot lifecycle
- Spring Batch Job / TaskletStep
- Tasklet `FINISHED`
- Spring transaction
- MyBatis Mapper呼び出し
- `ExecutorType.SIMPLE`
- `ExecutorType.BATCH`
- pending batch
- 手動`flushStatements()`
- 自動flush
- `flushThreshold`によるchunk処理と複数回flush
- flushごとの`BatchResult`蓄積(mapped statement ID、SQL、parameter count、update counts)
- BATCHのupdate count合計をflush結果から算出
- commit / rollback
- AWS Advanced JDBC WrapperからAurora writerまでの表示
- 正常終了`0`
- 警告終了`1`
- 異常終了`101`
- platform initiated stop `143`
- `TaskFailedToStart`
- lifecycle event timeline

### 画面

- RunTask設定パネル
- 正常、警告、異常、起動失敗の選択
- SIMPLE / BATCHの選択
- Mapper呼び出し数
- flush threshold表示
- 自動flush切り替え
- 手動flushボタン
- StopTaskボタン
- ECS、Spring、Batch、transaction状態
- pending / flushed statement数
- framework、application、container終了情報
- BatchResult一覧パネル(flush回数、parameter count、update counts合計、10件以下は配列表示)
- Java 21、task CPU、task memory、最大heap表示
- 6レイヤーのThree.jsシーン
- active layerと処理フローのアニメーション

## 現在の検証結果

- `npm test`: 19 tests passed
- `npm run typecheck`: passed
- `npm run build`: passed
- production dependency audit: 0 known vulnerabilities
- GitHub Pages build: passed
- GitHub Pages deploy: passed
- 公開HTML / JS / CSS: HTTP 200

2026-07-31にChrome自動操作で公開ページのdesktop QAを実施した。

- 重大バグを発見し修正済み: Piniaのdeep reactive proxyを`tick()`の`structuredClone()`へ渡していたため`DataCloneError`が毎フレーム発生し、公開ページではRunTask後にPROVISIONINGで完全に停止していた(MVP当初からの潜在バグ。純粋関数テストでは検出不能)。storeをプレーンなモジュール変数+shallowRef公開に変更し、Pinia storeテスト4件で回帰防止した。
- desktopで確認済み: BATCH正常(threshold 10単発flush / threshold 4で3回flushとBatchResult 3件蓄積)、autoFlush OFFでthresholdごとの停止と手動flushStatements()、StopTaskでSIGTERM→143→TX ROLLED_BACK→PENDING 0→FLUSHED保持、BatchResultパネル表示、timeline文言、console errorなし(修正後)。
- 未実施: mobile幅QA(Chromeウィンドウがフルスクリーンでresize不可だったため)。WARNING / ABNORMAL / LAUNCH_FAILURE / SIMPLEの目視確認(simulationテストでは検証済み)。次のセッションで実施すること。
- 補足: バックグラウンドタブではChromeのtimer throttlingとdelta cap(0.25s)によりシミュレーション進行が実時間より遅くなる。バグではない。

## 重要な設計境界

- `src/sim`はVue、Pinia、Three.js、Tailwind CSS、DOMをimportしない。
- Vue componentはシミュレーション状態を直接変更しない。
- Pinia actionから純粋なsimulation commandを呼ぶ。
- Three.js objectをPiniaへ保存しない。
- Three.js rendererがscene graphとper-frame状態を所有する。
- 表示、timeline、metricsは同じsimulation snapshotから生成する。
- wall clock、ネットワーク、AWS、DOM、GPUをsimulation testへ持ち込まない。

## 絶対に維持する意味上の区別

- ECS `RUNNING`はBatch Job成功を意味しない。
- Tasklet `FINISHED`はprocess exit code `0`を意味しない。
- Spring Batch `BatchStatus`と`ExitStatus`は別物。
- application resultとSpring exit codeは別物。
- Spring exit codeとcontainer exit codeは伝搬するが、常に同じとは限らない。
- container exit codeとECS `stopCode` / `stoppedReason`は別物。
- `flushStatements()`はcommitではない。
- flush済み、commit前の変更は未確定でありrollbackできる。
- BATCHのMapper呼び出し時点では最終update countは確定しない。
- partial update countsはpartial commitを意味しない。
- AWS Advanced JDBC WrapperはPostgreSQL JDBC Driverそのものではない。
- writerへの再接続は失敗transactionの安全な自動再実行を意味しない。

## 既知の不足と推奨順序

### P0: 画面QA

- 公開ページをdesktop幅で開く。
- RunTaskの正常、警告、異常、起動失敗を操作する。
- SIMPLE / BATCHのSQL実行数とpending / flushed表示を確認する。
- 自動flushをOFFにして、手動flushまで停止することを確認する。
- StopTaskの`143`とrollbackを確認する。
- browser consoleのerrorを確認する。
- mobile幅で操作不能、overflow、文字切れがないか確認する。
- screenshotを保存して目視する。

### P1: MyBatisモデルの完成度

済み(2026-07-31):

- `flushThreshold`をsimulationへ接続した。`RUN_TASKLET → FLUSH_BATCH → RUN_TASKLET`の循環でthresholdごとにchunk処理する。
- 複数回flushと`BatchResult`蓄積を実装した。
- BatchResult一覧(mapped statement ID、SQL、parameter count、update counts)をInspectorへ表示した。
- 最終端数chunkはcommit前flushとしてtimelineに区別して表示する。
- autoFlush=OFF時はthreshold到達ごとに停止し手動flushを待つ(大きなtickでもゲートを突き抜けない)。
- rollback後もBatchResultは診断情報として保持し、updateCountはnullのまま(partial commitと表示しない)。

済み(2026-08-01):

- `FLUSH_FAILURE`シナリオ(flush中の`BatchUpdateException`)を既存ABNORMALとは別シナリオとして追加した。
- `config.failAtStatement`(1-based global index、1..statementCountへ正規化)で失敗位置を設定できる。
- 失敗flushの`BatchResult`はpgjdbcの実挙動(autoCommit=false時は全長`EXECUTE_FAILED(-3)`)に合わせた: `updateCounts`全件-3、`successfulStatementCount` 0、`failedStatementIndex`はflush内1-based。-3は「未実行」ではなく「成功として保証されない」と説明する。
- SIMPLE + FLUSH_FAILUREはstatement失敗としてrollback(BatchResultなし)。
- UI: シナリオ選択、失敗位置スライダー、失敗flushの赤表示、×=EXECUTE_FAILED凡例、「partial update countsはpartial commitを意味しない」注記。

残り:

- `SUCCESS_NO_INFO(-2)`のupdate counts形式の扱い(合計に-2を含めない表示)。

### P1: 終了と障害

- Aurora接続失敗
- SQL例外の詳細
- writer failoverの状態遷移
- wrapper topology refresh
- 再接続後にJobを失敗させる場合と再試行する場合
- JVM `OutOfMemoryError`
- `-XX:+ExitOnOutOfMemoryError`
- ECS memory limitによる停止
- SIGTERM graceful shutdown
- stop timeout後のSIGKILL
- アプリが制御できない終了を`101`へ変換しないテスト

### P1: Java 21設定

- task CPUの操作
- task memoryの操作
- `InitialRAMPercentage`
- `MaxRAMPercentage`
- JVMが認識したCPU数
- heap / metaspace / native memoryの区別
- GC名とGC activity
- `JAVA_TOOL_OPTIONS`表示
- memory設定によるOOMシナリオ

### P2: 3D表現

- 現在の抽象boxを、ECS、container、Spring、MyBatis、JDBC、Auroraの意味が分かる建築へ発展させる。
- 3D内の各地区へラベルを付ける。
- hover / click pickingを実装する。
- 選択対象とInspectorを接続する。
- camera focusとresetを実装する。
- ENI作成、image pull、JVM起動、SQL、flush、commit、rollbackを別のflowとして表現する。
- reduced motionへ対応する。
- GPU resource disposeの自動テストを追加する。

### P2: Vue / Piniaテスト

- Pinia action test
- `RunTask` control component test
- exit code panel test
- warning `1`を非ゼロとして表示するtest
- manual flush button test
- component unmount時のrenderer / listener cleanup test
- accessibility test

### P2: 配信と保守

- production bundleが約613 kBで、500 kB warningが出ている。Three.jsのlazy loadまたはmanual chunk分割を検討する。
- GitHub ActionsからNode.js 20 action runtimeのdeprecation warningが出る。利用中actionの対応版が公開されたら更新する。
- repository licenseが未決定。所有者が方針を決めて`LICENSE`を追加する。
- Open Graph metadataとsocial previewは未設定。

## 現在の主要ファイル

- `IMPLEMENTATION_BRIEF.md`: 完成仕様と禁止事項
- `src/sim/types.ts`: simulation contract
- `src/sim/model.ts`: deterministic state machine
- `test/model.test.ts`: lifecycle、exit code、MyBatis executor test
- `test/mybatis-flush.test.ts`: flushThreshold、複数flush、BatchResult、手動flushゲートのtest
- `test/flush-failure.test.ts`: FLUSH_FAILURE、EXECUTE_FAILED配列、失敗位置、partial≠partial commitのtest
- `test/store.test.ts`: Pinia store経由のreactive proxy回帰test(structuredClone対策)
- `src/stores/simulation.ts`: Piniaとsimulationの接続
- `src/App.vue`: 現在の操作UIとInspector
- `src/components/CityCanvas.vue`: VueとThree.js rendererのlifecycle接続
- `src/three/create-world-renderer.ts`: Three.js scene graph
- `.github/workflows/ci.yml`: pull request検証
- `.github/workflows/pages.yml`: GitHub Pages deploy

## 次の推奨タスク

最初のタスクは「mobile幅の目視QA」にする(この環境ではChromeウィンドウのresizeとDevTools device emulationが拡張の制約で利用できなかったため未実施。実機または別環境で確認すること)。その後はP1「終了と障害」(Aurora接続失敗、writer failover、OOM系)またはP1「Java 21設定」へ進む。

機能追加ごとに次を実行する。

```bash
npm test
npm run typecheck
npm run build
```

見た目が変わる場合はbrowserでdesktopとmobileを確認し、console errorとscreenshotをレビューする。完了後にConventional Commitで`main`へpushし、GitHub Pagesのdeploy成功まで確認する。
