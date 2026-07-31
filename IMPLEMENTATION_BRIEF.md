# ECS Batch City 実装指示書

## 1. 目的

Amazon ECS の `RunTask` によって Fargate タスクが起動し、Java 21 上の Spring Boot / Spring Batch Tasklet が MyBatis と AWS Advanced JDBC Wrapper を経由して Aurora PostgreSQL にアクセスし、終了結果がコンテナの終了コードとして ECS に伝わるまでを、対話可能な 3D 教材として実装する。

このアプリケーションは AWS、Spring Batch、Aurora PostgreSQL の実環境を再現するエミュレーターではない。実際の仕組みと責務分界を理解するため、時間と数量を意図的に縮尺した決定論的なシミュレーターとする。画面上の説明、状態遷移、アニメーション、メトリクスは、同じモデル状態から生成すること。

## 2. リポジトリ方針

PGSimCity とは別のリポジトリを作成する。

推奨仮称は `ECSBatchCity` とする。名称は作成前にリポジトリ所有者が確定すること。

分離する理由は次のとおり。

- PGSimCity の主題は PostgreSQL 内部構造であり、今回の主題はコンテナバッチの実行ライフサイクルである。
- ECS、Java、Spring、MyBatis、JDBC、Aurora の状態モデルと用語を独立して管理できる。
- PGSimCity の地理、UI、シミュレーション契約を複雑化しない。
- 独自のロードマップ、リリース、GitHub Pages、テスト基準を設定できる。
- PGSimCity のコードを参照または移植する場合、由来とライセンスを明確に記録できる。

新規リポジトリでは、PGSimCity のソースを履歴ごとコピーして改造するのではなく、必要な汎用パターンだけをライセンス条件に従って移植する。移植したファイルはコミット時に出典を明示する。

## 3. MVP の対象範囲

MVP に含めるもの:

- Amazon ECS `RunTask`
- AWS Fargate
- `awsvpc` ネットワークモード
- 1タスクにつき essential container 1個
- Java 21
- Spring Boot
- Spring Batch の Job 1個、TaskletStep 1個、Tasklet 1個
- MyBatis Mapper と SQL mapping
- Spring 管理の `SqlSessionTemplate`
- Spring Transaction Manager
- HikariCP
- AWS Advanced JDBC Wrapper
- PostgreSQL JDBC Driver
- Aurora PostgreSQL writer
- `BEGIN`、SQL実行、`COMMIT`、`ROLLBACK`
- Spring Batch、アプリ、JVM、コンテナ、ECSの終了状態
- 正常、警告、異常、起動失敗、外部停止のシナリオ
- 日本語 UI
- GitHub Pages への静的デプロイ

MVP に含めないもの:

- 実AWSアカウントへの接続
- AWS SDKを使った実際の `RunTask`
- ブラウザ内でのJVMまたはSpring Bootの実行
- ECS Service
- Kubernetes / Amazon EKS
- chunk-oriented Step
- partitioning / remote chunking
- RDS Proxy
- Aurora reader endpoint
- 実CloudWatchデータの取得
- 認証情報、AWS access key、DB passwordの入力または保存

## 4. 技術スタック

- TypeScript strict mode
- Three.js
- Vite
- Vitest
- HTML / CSS
- Node.js 22 以上を開発・ビルドに使用
- フロントエンドフレームワークは初版では使用しない

3Dアプリの実行時依存を増やす場合は、必要性、bundleへの影響、ライセンス、メンテナンス性を設計記録に残すこと。外部CDN、外部フォント、テレメトリ、実AWS API呼び出しを無断で追加しない。

## 5. 全体モデル

シミュレーション上の主要フローを次の順序で表現する。

```text
RunTask request
  -> ECS control plane
  -> task placement
  -> ENI provisioning
  -> image pull
  -> container creation
  -> JVM startup
  -> Spring Boot startup
  -> Spring Batch Job
  -> TaskletStep
  -> Tasklet.execute()
  -> MyBatis Mapper
  -> SqlSessionTemplate
  -> Spring Transaction Manager
  -> HikariCP
  -> AWS Advanced JDBC Wrapper
  -> PostgreSQL JDBC Driver
  -> Aurora PostgreSQL writer
  -> result propagation
  -> SpringApplication.exit()
  -> System.exit(code)
  -> container exitCode
  -> ECS task STOPPED
```

各層を別の状態として保持する。アニメーションだけで状態を表現しない。

## 6. ECS タスク状態

ECS タスクは少なくとも次の状態を持つ。

```ts
type EcsTaskStatus =
  | 'PROVISIONING'
  | 'PENDING'
  | 'ACTIVATING'
  | 'RUNNING'
  | 'DEACTIVATING'
  | 'STOPPING'
  | 'DEPROVISIONING'
  | 'STOPPED'
```

各状態の意味を正確に区別する。

- `PROVISIONING`: ENIなど、タスク起動前に必要なリソースを準備する。
- `PENDING`: 実行に必要なリソースまたはエージェント処理を待つ。
- `ACTIVATING`: image pull、コンテナ作成、ネットワーク設定を行う。
- `RUNNING`: essential containerが実行中である。Spring Batchの成功を意味しない。
- `DEACTIVATING`: 停止前処理を行う。
- `STOPPING`: コンテナ停止を待つ。
- `DEPROVISIONING`: ENIなどのリソースを解放する。
- `STOPPED`: タスクが停止した。成功を意味しない。

`desiredStatus` と `lastStatus` を別フィールドで保持する。`stopCode`、`stoppedReason`、container `exitCode` も混同しない。

## 7. コンテナ起動モデル

`ACTIVATING` 中に次の段階を可視化する。

1. Task Definition revisionを解決する。
2. ECR相当の保管庫からimage manifestを取得する。
3. image layersをpullする。
4. root filesystemを構成する。
5. ENIとsecurity groupを接続する。
6. environment、secret参照、commandを設定する。
7. Javaプロセスを起動する。

起動失敗は少なくとも次を区別する。

- task placement failure
- image pull failure
- ENI provisioning failure
- invalid task definition
- secret取得失敗
- Java command起動失敗

これらはSpring Batchの異常終了ではない。Jobが始まる前の失敗として扱う。

## 8. Java 21 モデル

Task DefinitionまたはJava設定パネルに次を表示する。

- Java major version: 21
- JVM vendor
- JVM implementation
- container image name / digest
- CPU architecture
- task CPU / task memory
- JVMが認識したCPU数
- JVMが認識したコンテナメモリ
- initial heap / maximum heap
- current heap usage
- metaspace
- native memoryの予約領域
- thread count
- GC名
- JVM uptime
- `JAVA_TOOL_OPTIONS`
- system properties
- process PID

初期設定例:

```text
-XX:InitialRAMPercentage=20
-XX:MaxRAMPercentage=70
-XX:+ExitOnOutOfMemoryError
-Dfile.encoding=UTF-8
-Duser.timezone=Asia/Tokyo
-Xlog:gc*:stdout:time,level,tags
```

数値は固定のベストプラクティスとして説明しない。Task memoryの30%を必ず空きとして保証する設定でもない。heap外にはMetaspace、thread stack、direct buffer、code cache、JNI、JDBC、Springなどのメモリが必要であることを表示する。

次の終了原因を区別する。

- アプリケーションが `System.exit()` を呼んだ。
- 未処理例外でmain threadが終了した。
- `ExitOnOutOfMemoryError` によりJVMが終了した。
- ECSのメモリ上限によりコンテナが停止した。
- `StopTask` により `SIGTERM` を受信した。
- stop timeout後に `SIGKILL` された。

JVMまたはコンテナランタイムが直接終了させた場合、アプリ独自の終了コード `101` が必ず返るとは説明しない。

## 9. Spring Boot / Spring Batch モデル

次の状態を独立して保持する。

```ts
type SpringApplicationStatus =
  | 'NOT_STARTED'
  | 'STARTING'
  | 'READY'
  | 'CLOSING'
  | 'CLOSED'
  | 'FAILED'

type BatchStatus =
  | 'UNKNOWN'
  | 'STARTING'
  | 'STARTED'
  | 'STOPPING'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABANDONED'

type TaskletRepeatStatus = 'FINISHED' | 'CONTINUABLE'
```

Taskletの `RepeatStatus` はOS終了コードではない。`FINISHED` はTaskletの反復が完了したことを表し、Job全体のプロセス終了コード `0` を直接意味しない。

Spring Batchの `BatchStatus` と文字列の `ExitStatus` を分ける。警告終了では次の状態を許可する。

```text
BatchStatus = COMPLETED
ExitStatus  = WARNING
```

## 10. アプリケーション終了コード

アプリケーションの正式な結果を次の3種類とする。

| 結果 | 数値 | 意味 |
|---|---:|---|
| `NORMAL` | 0 | 正常終了 |
| `WARNING` | 1 | 処理完了。ただし運用上の確認が必要 |
| `ABNORMAL` | 101 | アプリ制御下で検出した異常終了 |

変換規則:

```text
Job BatchStatus == FAILED
  -> ABNORMAL / 101

Job ExitStatus == WARNING
  -> WARNING / 1

Job BatchStatus == COMPLETED
  -> NORMAL / 0
```

最終終了コードを決定するコンポーネントは1つにする。複数の `ExitCodeGenerator` に業務判定を分散させない。

伝搬経路:

```text
Tasklet result
  -> Step BatchStatus / ExitStatus
  -> Job BatchStatus / ExitStatus
  -> application result
  -> ExitCodeGenerator
  -> SpringApplication.exit(context)
  -> System.exit(code)
  -> JVM process exit
  -> container exitCode
  -> ECS task state change event
```

ECSは `1` を業務上の警告として理解しない。ECSおよび一般的なプロセス監視から見れば非ゼロ終了である。画面には必ず次を並べて表示する。

```text
Application result: WARNING
Application exit code: 1
Container exit code: 1
Platform interpretation: non-zero exit
```

未定義の終了コード、signal、OOM、task launch failureは `NORMAL`、`WARNING`、`ABNORMAL` に無理に変換せず、platform/JVM failureとして別分類する。

## 11. MyBatis とトランザクション

コンテナ内部の呼び出し順を次のようにする。

```text
Tasklet
  -> Mapper interface
  -> mapped statement
  -> SqlSessionTemplate
  -> Spring Transaction Manager
  -> DataSource / HikariCP
```

MyBatis-Springの `SqlSessionTemplate` をSpringトランザクションに参加させる。TaskletまたはMapperが `SqlSession.commit()`、`rollback()`、`close()` を直接呼ぶ構成として説明しない。

正常時:

```text
transaction begin
  -> mapper invocation
  -> SQL execution
  -> affected rows
  -> Tasklet FINISHED
  -> commit
```

警告例:

```text
SQL succeeded
  -> affected rows == 0
  -> Tasklet FINISHED
  -> Step ExitStatus WARNING
  -> commit
  -> application exit code 1
```

異常例:

```text
SQL exception
  -> exception translation
  -> rollback
  -> Step FAILED
  -> Job FAILED
  -> application exit code 101
```

## 12. JDBC 接続スタック

次のレイヤーを省略せず表示する。

```text
HikariCP
  -> AWSWrapperDataSource
  -> AWS Advanced JDBC Wrapper plugin chain
  -> PostgreSQL JDBC Driver
  -> PostgreSQL frontend/backend protocol
  -> Aurora PostgreSQL endpoint
```

AWS Advanced JDBC WrapperはPostgreSQL JDBC Driverそのものではない。基礎となるJDBC Driverを包み、Aurora向け機能を追加するレイヤーとして説明する。

MVPで可視化するWrapper機能:

- connection request interception
- plugin chain
- Aurora topology awareness
- writer host selection
- connection establishment
- connection failure
- writer failover detection
- new writerへの再接続

新しいwriterへの再接続と、失敗したSQLまたはトランザクションの安全な再実行を同一視しない。再接続後にTaskletを再試行するか、Jobを失敗させるかはアプリケーションとSpring Batch側の方針で決まる。

## 13. Aurora PostgreSQL モデル

MVPではwriter instanceとcluster storageを表現する。

表示する状態:

- endpoint
- writer host
- connection count
- borrowed / idle pool connections
- active transaction count
- query latency
- rows read / written
- commit / rollback count
- connection failure
- writer failover state

Aurora固有の仕組みと通常のPostgreSQLの仕組みを混同しない。簡略化した値や時間はUI内で明示する。

## 14. 3D 地区と視覚表現

最小構成:

- RunTask control terminal
- ECS control plane tower
- Task Definition archive
- ECR image warehouse
- Fargate launch pads
- ENI / VPC network gate
- container cutaway view
- JVM engine room
- Spring Boot context chamber
- Spring Batch Job / Step / Tasklet line
- MyBatis SQL mapping station
- HikariCP connection pool
- AWS JDBC Wrapper routing station
- PostgreSQL protocol bridge
- Aurora writer building
- lifecycle and exit-code timeline

色の意味:

- 緑: 正常、exit code 0
- 黄: 警告、exit code 1
- 赤: アプリ制御下の異常、exit code 101
- 紫: 未定義またはJVM/プラットフォーム異常
- 青: 起動・通常通信
- 灰: 停止済みまたは外部停止

色だけに依存せず、ラベル、形、アイコン、状態テキストを併用する。

## 15. 操作項目

- RunTask
- StopTask
- 同時起動Task数
- task CPU
- task memory
- image pull時間
- Spring Boot起動時間
- Tasklet実行時間
- SQL実行時間
- HikariCP maximumPoolSize
- Aurora最大接続数
- `InitialRAMPercentage`
- `MaxRAMPercentage`
- 正常 / 警告 / 異常シナリオ
- DB接続失敗
- SQL失敗
- writer failover
- OOM
- SIGTERM / SIGKILL
- シミュレーション速度

各操作は状態モデルへ入力し、DOMまたはthree.js objectを直接操作して結果を捏造しない。

## 16. 必須シナリオ

### 正常終了

```text
RunTask
  -> task RUNNING
  -> Spring READY
  -> Job STARTED
  -> Tasklet FINISHED
  -> COMMIT
  -> Job COMPLETED
  -> System.exit(0)
  -> container exitCode 0
  -> task STOPPED
```

### 警告終了

```text
RunTask
  -> SQL成功、更新対象0件
  -> Tasklet FINISHED
  -> BatchStatus COMPLETED
  -> ExitStatus WARNING
  -> System.exit(1)
  -> container exitCode 1
  -> task STOPPED
```

### 異常終了

```text
RunTask
  -> SQL例外
  -> ROLLBACK
  -> Step FAILED
  -> Job FAILED
  -> System.exit(101)
  -> container exitCode 101
  -> task STOPPED
```

### 起動失敗

```text
RunTask
  -> ACTIVATING
  -> image pullまたはENI設定失敗
  -> Springは未起動
  -> TaskFailedToStart
  -> task STOPPED
```

### StopTask

```text
StopTask
  -> SIGTERM
  -> Spring shutdown hook
  -> graceful shutdown または timeout
  -> 必要ならSIGKILL
  -> task STOPPED
```

### Writer failover

```text
SQL実行中にwriter障害
  -> Wrapperが接続障害を検出
  -> topology更新
  -> new writerを特定
  -> 再接続
  -> アプリ方針に従って失敗または再試行
```

## 17. 推奨ソース構成

```text
src/
  core/
    types.ts
    bus.ts
    registry.ts
    theme.ts
  sim/
    ecs.ts
    container.ts
    java.ts
    spring.ts
    batch.ts
    mybatis.ts
    jdbc.ts
    aurora.ts
    scenarios.ts
  world/
    layout.ts
    ecs-district.ts
    container-cutaway.ts
    java-room.ts
    spring-line.ts
    jdbc-route.ts
    aurora.ts
  engine/
    renderer.ts
    camera.ts
    flows.ts
    picking.ts
    labels.ts
  ui/
    hud.ts
    controls.ts
    inspector.ts
    timeline.ts
    explanations.ts
  main.ts
test/
  lifecycle.test.ts
  exit-code-propagation.test.ts
  transaction.test.ts
  scenario-contracts.test.ts
```

`src/sim` はThree.jsやDOMをimportしない。`src/world`、`src/engine`、`src/ui`はシミュレーション状態を変更せず、コマンドをイベントとしてモデルへ渡す。

## 18. テスト要件

red/green TDDを必須とする。最初に純粋な状態モデルをテストし、その後で3D表示へ接続する。

最低限、次を自動テストする。

- RunTaskからSTOPPEDまでの正常な状態順序
- 起動失敗時にSpring状態へ進まないこと
- `RUNNING` がJob成功を意味しないこと
- Tasklet `FINISHED` がexit code `0`を直接意味しないこと
- `COMPLETED + WARNING -> 1`
- `FAILED -> 101`
- exit code 1がECS視点では非ゼロであること
- OOMやSIGKILLを強制的に101へ変換しないこと
- MyBatis処理がSpringトランザクションへ参加すること
- SQL例外時にrollbackされること
- Wrapper再接続とトランザクション再実行を区別すること
- 同じseedと入力から同じ結果になること
- UI説明とモデル状態が一致すること

wall clock、実ネットワーク、実AWS、GPUへ依存するテストを状態モデルに持ち込まない。

## 19. 実装フェーズ

### Phase 0: リポジトリ作成

- 新規リポジトリ名を確定
- README、LICENSE、AGENTS.md、CLAUDE.mdを作成
- Vite、TypeScript、Three.js、Vitestを設定
- GitHub Actionsでtest、typecheck、buildを実行
- GitHub Pages workflowを設定

### Phase 1: 状態モデル

- ECS task lifecycle
- container lifecycle
- Java process lifecycle
- Spring application lifecycle
- Batch Job / Step / Tasklet
- 終了コード伝搬
- シナリオテスト

### Phase 2: 基本3D世界

- ECS地区
- RunTask terminal
- Fargate task launch
- container cutaway
- Aurora地区
- camera、labels、picking

### Phase 3: アプリケーションスタック

- Java 21 room
- Spring Boot context
- Tasklet
- MyBatis
- HikariCP
- Advanced JDBC Wrapper
- PostgreSQL Driver
- SQL flow

### Phase 4: 終了と障害

- 正常0
- 警告1
- 異常101
- launch failure
- OOM
- SIGTERM / SIGKILL
- writer failover
- lifecycle timeline

### Phase 5: 品質と公開

- 全テスト
- typecheck
- production build
- desktop / mobile visual verification
- keyboard操作
- reduced motion
- GitHub Pages deploy

## 20. 完成条件

- RunTask操作からECS Task STOPPEDまでを追跡できる。
- ECS、コンテナ、JVM、Spring、Batch、Taskletの状態が別々に表示される。
- Tasklet、MyBatis、AWS Wrapper、PostgreSQL Driver、Auroraの責務が区別される。
- 正常0、警告1、異常101がアプリからコンテナまで伝搬する。
- warningのexit code 1がECSからは非ゼロと見えることを説明する。
- JVMまたはECSによる強制終了をアプリの101として偽装しない。
- Java 21のCPU、memory、heap、GC、JVM optionを操作・確認できる。
- 正常、警告、異常、起動失敗、StopTask、OOM、failoverを再現できる。
- すべての数値と状態遷移がテスト可能なモデルから生成される。
- 日本語表示で、初見の利用者が各レイヤーの責務を説明できる。
- GitHub Pagesで静的に実行でき、実AWSや認証情報を必要としない。

## 21. 公式参照資料

- Amazon ECS task lifecycle: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html>
- Amazon ECS stopped task events: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-events.html>
- Amazon ECS StopTask: <https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html>
- Spring Boot application exit: <https://docs.spring.io/spring-boot/reference/features/spring-application.html>
- Spring Batch running jobs and exit codes: <https://docs.spring.io/spring-batch/reference/job/running.html>
- Spring Batch ExitStatus: <https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/ExitStatus.html>
- MyBatis-Spring transactions: <https://mybatis.org/spring/transactions.html>
- MyBatis-Spring SqlSessionTemplate: <https://mybatis.org/spring/sqlsession.html>
- AWS Advanced JDBC Wrapper: <https://github.com/aws/aws-advanced-jdbc-wrapper>
- Java 21 command options: <https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html>

## 22. 実装時の禁止事項

- ECS `RUNNING` をバッチ成功として表示しない。
- Tasklet `FINISHED` をプロセス終了コード0として直結しない。
- Spring Batch `ExitStatus` とOS終了コードを同じ型にしない。
- MyBatis Mapperが独自にcommitまたはrollbackすると説明しない。
- AWS Advanced JDBC WrapperをPostgreSQL JDBC Driverそのものとして扱わない。
- failover後に失敗トランザクションが必ず自動再実行されると説明しない。
- exit code 1をECSが警告として理解すると説明しない。
- OOM、SIGKILL、TaskFailedToStartをアプリ異常コード101へ強制変換しない。
- 実AWS認証情報をブラウザ、リポジトリ、GitHub Actionsへ保存しない。
- 見た目だけのアニメーションを作り、対応する状態モデルとテストを省略しない。
