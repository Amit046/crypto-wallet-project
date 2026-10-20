import org.apache.spark.sql.{DataFrame, Row, SparkSession}
import org.apache.spark.sql.functions._
import org.apache.spark.ml.feature.VectorAssembler
import org.apache.spark.ml.classification.LogisticRegression
import org.apache.spark.ml.evaluation.BinaryClassificationEvaluator
import org.apache.spark.ml.functions.vector_to_array
import org.apache.spark.graphx._
import org.apache.spark.rdd.RDD
import java.io.{File, PrintWriter}
import java.nio.file.{Files, Paths}

object Main {

  // GraphX ke liye kitne time steps use karne hain (1 se maxTimeStep tak).
  val maxTimeStep = 10

  def main(args: Array[String]): Unit = {

    val spark = SparkSession.builder()
      .appName("CryptoWalletAnalysis")
      .master("local[4]")
      .config("spark.ui.enabled", "false")
      .config("spark.sql.shuffle.partitions", "8")
      .config("spark.default.parallelism", "8")
      .getOrCreate()
    spark.sparkContext.setLogLevel("ERROR")
    import spark.implicits._

    // ---------- Helpers: print karo + file mein save karo ----------
    val out = new StringBuilder
    def log(s: String): Unit = { println(s); out.append(s).append("\n") }
    def tbl(df: DataFrame, n: Int = 20): String = {
      val rows = df.take(n)
      (df.columns.mkString(" | ") +: rows.map(_.mkString(" | ")).toSeq).mkString("\n")
    }
    def timed[T](label: String)(block: => T): T = {
      val t0 = System.currentTimeMillis()
      val r = block
      log(s"[$label] finished in ${(System.currentTimeMillis() - t0) / 1000.0} sec\n")
      r
    }
    def writeCsv(path: String, header: Seq[String], rows: Array[Row]): Unit = {
      val pw = new PrintWriter(new File(path), "UTF-8")
      try {
        pw.println(header.mkString(","))
        rows.foreach(r => pw.println(r.toSeq.mkString(",")))
      } finally pw.close()
    }

    // ============================================================
    // STAGE 1: SPARK SQL (CO5)
    // ============================================================
    log("################ STAGE 1: SPARK SQL ################")

    val classesDF = spark.read.option("header", "true").csv("data/elliptic_txs_classes.csv")

    val rawFeatures = spark.read.option("header", "false").csv("data/elliptic_txs_features.csv")
      .withColumnRenamed("_c0", "txId")
      .withColumnRenamed("_c1", "timeStep")

    // _c2 ... _c166 = 165 anonymized features (time step ko feature nahi bana rahe)
    val featureCols = (2 to 166).map(i => s"_c$i").toArray
    val selectCols = Seq(col("txId"), col("timeStep").cast("int").as("timeStep")) ++
      featureCols.map(c => col(c).cast("double"))
    val numericDF = rawFeatures.select(selectCols: _*)

    val joinedDF = numericDF.join(classesDF, Seq("txId"), "inner")
    joinedDF.createOrReplaceTempView("transactions")

    timed("Spark SQL") {
      log("Total rows after join: " + joinedDF.count())

      log("\n=== Class distribution (1=illicit, 2=licit) ===")
      log(tbl(spark.sql(
        "SELECT class, COUNT(*) AS total FROM transactions GROUP BY class ORDER BY total DESC")))

      log("\n=== Transactions per time step ===")
      log(tbl(spark.sql(
        """SELECT timeStep,
          |       SUM(CASE WHEN class = '1' THEN 1 ELSE 0 END) AS illicit,
          |       SUM(CASE WHEN class = '2' THEN 1 ELSE 0 END) AS licit,
          |       SUM(CASE WHEN class = 'unknown' THEN 1 ELSE 0 END) AS unknown_cnt,
          |       COUNT(*) AS total
          |FROM transactions
          |GROUP BY timeStep
          |ORDER BY timeStep""".stripMargin), 49))
    }

    // ============================================================
    // STAGE 2: MLLIB - Logistic Regression (CO4)
    // ============================================================
    log("################ STAGE 2: MLLIB ################")

    val assembler = new VectorAssembler().setInputCols(featureCols).setOutputCol("features")
    val allAssembled = assembler.transform(joinedDF).select("txId", "timeStep", "class", "features")

    // txId ko saath rakha hai, taaki baad mein pata chale kaun train mein tha aur kaun test mein.
    // IMPORTANT: txId sabse LAST column rakho. randomSplit columns ko sort karke split karta hai,
    // isliye txId pehle rakhne se split badal jata hai aur model ke numbers badal jaate hain.
    val labeledDF = allAssembled
      .filter(col("class") =!= "unknown")
      .withColumn("label", when(col("class") === "1", 1.0).otherwise(0.0))
      .select("features", "label", "txId")
      .cache()

    val Array(trainDF, testDF) = labeledDF.randomSplit(Array(0.8, 0.2), seed = 42)

    val model = timed("MLlib training") {
      new LogisticRegression().setLabelCol("label").setFeaturesCol("features").fit(trainDF)
    }

    val predictions = model.transform(testDF)
    val auc = new BinaryClassificationEvaluator()
      .setLabelCol("label").setRawPredictionCol("rawPrediction")
      .setMetricName("areaUnderROC").evaluate(predictions)

    val cm = predictions.groupBy("label", "prediction").count().collect()
      .map(r => ((r.getDouble(0), r.getDouble(1)), r.getLong(2))).toMap
    val tp = cm.getOrElse((1.0, 1.0), 0L).toDouble
    val fp = cm.getOrElse((0.0, 1.0), 0L).toDouble
    val fn = cm.getOrElse((1.0, 0.0), 0L).toDouble
    val tn = cm.getOrElse((0.0, 0.0), 0L).toDouble
    val accuracy  = (tp + tn) / (tp + tn + fp + fn)
    val precision = if (tp + fp > 0) tp / (tp + fp) else 0.0
    val recall    = if (tp + fn > 0) tp / (tp + fn) else 0.0
    val f1        = if (precision + recall > 0) 2 * precision * recall / (precision + recall) else 0.0

    log(s"Train rows: ${trainDF.count()}, Test rows: ${testDF.count()}")
    log("\n=== Confusion Matrix (test data) ===")
    log(f"TP (illicit pakda)      : ${tp.toLong}")
    log(f"FP (galat alarm)        : ${fp.toLong}")
    log(f"FN (illicit miss hua)   : ${fn.toLong}")
    log(f"TN (licit sahi)         : ${tn.toLong}")
    log(f"\nAUC       : $auc%.4f")
    log(f"Accuracy  : $accuracy%.4f")
    log(f"Precision : $precision%.4f")
    log(f"Recall    : $recall%.4f")
    log(f"F1-score  : $f1%.4f\n")

    // ============================================================
    // STAGE 3: GRAPHX (CO6)  -  subset: time step 1 .. maxTimeStep
    // ============================================================
    log(s"################ STAGE 3: GRAPHX (time steps 1-$maxTimeStep) ################")

    val edgesDF = spark.read.option("header", "true")
      .csv("data/elliptic_txs_edgelist.csv").toDF("src", "dst")

    val subsetIds = numericDF.filter(col("timeStep") <= maxTimeStep).select("txId")

    val subsetEdges = edgesDF
      .join(subsetIds.withColumnRenamed("txId", "src"), "src")
      .join(subsetIds.withColumnRenamed("txId", "dst"), "dst")
      .select("src", "dst")

    val subsetClasses = classesDF.join(subsetIds, "txId")

    val edgeRDD: RDD[Edge[Int]] = subsetEdges.rdd
      .map(r => Edge(r.getString(0).toLong, r.getString(1).toLong, 1))
      .repartition(4)

    val vertexRDD: RDD[(VertexId, String)] = subsetClasses.rdd
      .map(r => (r.getAs[String]("txId").toLong, r.getAs[String]("class")))
      .repartition(4)

    val graph = Graph(vertexRDD, edgeRDD, "unknown").cache()

    timed("Graph size") {
      log(s"Vertices: ${graph.vertices.count()}, Edges: ${graph.edges.count()}")
    }

    // ---- 3a: Degree analysis ----
    val degDF = graph.degrees.toDF("txId_l", "degree")

    timed("Degree analysis") {
      val withLabel = graph.degrees.join(graph.vertices)
        .map { case (id, (deg, label)) => (id, deg, label) }
        .toDF("txId", "degree", "label")
      log("=== Average connections by label (1=illicit, 2=licit) ===")
      log(tbl(withLabel.groupBy("label").agg(avg("degree").as("avg_degree"), count("*").as("n"))))
      log("\n=== Top 10 most connected transactions ===")
      log(tbl(withLabel.orderBy(desc("degree")), 10))
    }

    // ---- 3b: Connected components ----
    val cc = graph.connectedComponents(10)
    val ccDF = cc.vertices.join(graph.vertices)
      .map { case (id, (comp, label)) => (id, comp, label) }
      .toDF("txId_l", "component", "label").cache()

    val clusterDF = ccDF.groupBy("component").agg(
      count("*").as("size"),
      sum(when(col("label") === "1", 1).otherwise(0)).as("illicit"),
      sum(when(col("label") === "2", 1).otherwise(0)).as("licit"),
      sum(when(col("label") === "unknown", 1).otherwise(0)).as("unknown_cnt")
    ).cache()

    timed("Connected components") {
      log("=== 10 sabse bade clusters ===")
      log(tbl(clusterDF.orderBy(desc("size")), 10))
      log("\n=== Clusters jinme sabse zyada illicit hain ===")
      log(tbl(clusterDF.orderBy(desc("illicit")), 10))
      log("\nClusters with at least 1 illicit: " + clusterDF.filter(col("illicit") > 0).count())
      log("Total clusters: " + clusterDF.count())
    }

    // ---- 3c: PageRank ----
    val prDF = graph.staticPageRank(5).vertices.toDF("txId_l", "pagerank").cache()

    timed("PageRank") {
      val pr = prDF.join(graph.vertices.toDF("txId_l", "label"), "txId_l")
        .select(col("txId_l").as("txId"), col("pagerank"), col("label"))
      log("=== Top 10 PageRank transactions ===")
      log(tbl(pr.orderBy(desc("pagerank")), 10))
    }

    // ============================================================
    // STAGE 4: MLlib + GraphX combined (L6: Create)
    // ============================================================
    log("################ STAGE 4: ML + GRAPH COMBINED ################")

    timed("Combined analysis") {
      val unknownSubset = allAssembled
        .filter(col("class") === "unknown" && col("timeStep") <= maxTimeStep)
        .withColumn("txId_l", col("txId").cast("long"))

      val scored = model.transform(unknownSubset)
        .select("txId_l", "prediction")
        .join(ccDF.select("txId_l", "component"), "txId_l")
        .join(clusterDF.select("component", "size", "illicit"), "component")
        .withColumn("inRisky", when(col("illicit") > 0, 1).otherwise(0))
        .withColumn("density", col("illicit") / col("size"))
        .cache()

      val rows = scored.groupBy("prediction").agg(
        count("*").as("n"),
        sum("inRisky").as("risky"),
        avg("density").as("avgDensity")
      ).collect().map(r => (r.getDouble(0), (r.getLong(1), r.getLong(2), r.getDouble(3)))).toMap

      val (nF, rF, dF) = rows.getOrElse(1.0, (0L, 0L, 0.0))   // model ne illicit flag kiya
      val (nN, rN, dN) = rows.getOrElse(0.0, (0L, 0L, 0.0))   // model ne licit bola
      val nAll = nF + nN
      val rAll = rF + rN

      val pctF   = 100.0 * rF / math.max(nF, 1L)
      val pctN   = 100.0 * rN / math.max(nN, 1L)
      val pctAll = 100.0 * rAll / math.max(nAll, 1L)
      val lift   = if (pctAll > 0) pctF / pctAll else 0.0

      log(s"Unknown transactions (time step 1-$maxTimeStep): $nAll")
      log(s"  Model ne illicit flag kiye : $nF")
      log(s"  Model ne licit bola         : $nN")
      log("\n=== Kitne % transactions aise cluster mein hain jahan known illicit bhi hai ===")
      log(f"  Flagged (model: illicit)    : $pctF%.1f %%")
      log(f"  Not flagged (model: licit)  : $pctN%.1f %%")
      log(f"  Baseline (saare unknown)    : $pctAll%.1f %%")
      log(f"  Lift (flagged / baseline)   : $lift%.2f")
      log("\n=== Cluster ka average illicit density (illicit / cluster size) ===")
      log(f"  Flagged                     : ${dF * 100}%.2f %%")
      log(f"  Not flagged                 : ${dN * 100}%.2f %%")
    }

    // ============================================================
    // STAGE 5: DASHBOARD KE LIYE EXPORT
    // Har transaction ka result: model risk, links, PageRank, cluster, train/test.
    // ============================================================
    log("################ STAGE 5: EXPORT FOR DASHBOARD ################")

    timed("Export") {
      // model ka risk score (illicit hone ki probability) subset ke saare transactions ke liye
      val scoredAll = model.transform(allAssembled.filter(col("timeStep") <= maxTimeStep))
        .withColumn("risk", vector_to_array(col("probability")).getItem(1))
        .select(col("txId").cast("long").as("txId_l"), col("timeStep"), col("class"),
                col("risk"), col("prediction"))

      // kaun train mein tha, kaun test mein
      val splitDF = trainDF.select(col("txId").cast("long").as("txId_l")).withColumn("split", lit("train"))
        .union(testDF.select(col("txId").cast("long").as("txId_l")).withColumn("split", lit("test")))

      val nodesDF = scoredAll
        .join(degDF, Seq("txId_l"), "left")
        .join(prDF, Seq("txId_l"), "left")
        .join(ccDF.select("txId_l", "component"), Seq("txId_l"), "left")
        .join(clusterDF.select(col("component"), col("size").as("cluster_size"),
                               col("illicit").as("cluster_illicit")), Seq("component"), "left")
        .join(splitDF, Seq("txId_l"), "left")
        .withColumn("split", coalesce(col("split"), lit("unlabeled")))
        .withColumn("degree", coalesce(col("degree"), lit(0)))
        .select(
          col("txId_l").as("txId"), col("timeStep"), col("class"),
          round(col("risk"), 5).as("risk"), col("prediction").cast("int").as("predicted"),
          col("degree"), round(col("pagerank"), 4).as("pagerank"),
          col("component"), col("cluster_size"), col("cluster_illicit"), col("split"))

      new File("output").mkdirs()
      val nodeRows = nodesDF.collect()
      writeCsv("output/transactions.csv", nodesDF.columns.toSeq, nodeRows)
      val edgeRows = subsetEdges.collect()
      writeCsv("output/edges.csv", Seq("src", "dst"), edgeRows)
      log(s"Saved ${nodeRows.length} transactions and ${edgeRows.length} links for the dashboard")
    }

    // ---------- Results file mein save karo ----------
    new File("output").mkdirs()
    Files.write(Paths.get("output/results.txt"), out.toString.getBytes("UTF-8"))
    println("\n>>> Saara result output/results.txt mein save ho gaya <<<")
    println(">>> Dashboard ka data output/transactions.csv aur output/edges.csv mein save ho gaya <<<")

    spark.stop()
  }
}