# Crypto Wallet Project — Bitcoin Transaction Detection

A big data analytics project designed to analyze Bitcoin transactions and identify potentially illicit transactions using **Scala, Apache Spark, Spark SQL, MLlib, GraphX, and Flask**.

## Overview

The project analyzes Bitcoin transaction data to explore transaction patterns, classify transactions, and investigate relationships between transactions using distributed data processing and machine learning techniques.

It also includes a Flask-based dashboard for presenting analysis results.

## Tech Stack

- **Programming Language:** Scala, Python
- **Big Data Processing:** Apache Spark
- **Data Analysis:** Spark SQL
- **Machine Learning:** Spark MLlib
- **Graph Analytics:** GraphX
- **Dashboard:** Flask
- **Build Tool:** SBT
- **Dataset:** Elliptic Bitcoin Transaction Dataset

## Project Features

- Bitcoin transaction data processing using Apache Spark.
- Transaction classification using machine learning techniques.
- Graph-based analysis of transaction relationships.
- Data analysis using Spark SQL.
- Visualization and presentation of analysis results through a Flask dashboard.
- Processing of large-scale transaction datasets.

## Project Structure

```text
crypto-wallet-project/
├── crypto_dashboard/    # Flask dashboard
├── data/                # Transaction dataset files
├── output/              # Generated analysis results
├── project/             # SBT project configuration
├── src/                 # Scala source code
├── build.sbt            # Build configuration
├── .gitignore
└── README.md
```

## Dataset

This project uses the Elliptic Bitcoin Transaction Dataset, which contains transaction features, transaction labels, and transaction relationship information.

The dataset files used in this project include:

- `elliptic_txs_classes.csv` — Transaction class labels.
- `elliptic_txs_edgelist.csv` — Relationships between transactions.
- `elliptic_txs_features.csv` — Transaction feature data.

**Note:** The large `elliptic_txs_features.csv` file is excluded from this GitHub repository because it exceeds GitHub's standard 100 MB per-file limit. You must obtain the dataset separately and place it in the `data/` directory before running the complete analysis.

## Prerequisites

Install the following before running the project:

- Java Development Kit (JDK)
- Scala
- SBT (Scala Build Tool)
- Apache Spark
- Python 3
- Required Python packages for the Flask dashboard

Compatible versions should be selected according to the project's `build.sbt` configuration and Python dependencies.

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Amit046/crypto-wallet-project.git
cd crypto-wallet-project
```

### 2. Configure the dataset

Place the required Elliptic dataset CSV files in the `data/` directory.

Ensure that the large transaction features file is available locally before running any analysis that depends on it.

### 3. Build the Scala project

```bash
sbt compile
```

### 4. Run the analysis

Run the project's Scala/Spark entry point using the command and main class configured in the source code.

For example, an SBT project may use:

```bash
sbt run
```

The exact command depends on the project's configured main class and Spark setup.

### 5. Run the Flask dashboard

Navigate to the dashboard directory:

```bash
cd crypto_dashboard
```

Install the Python dependencies if a `requirements.txt` file is provided:

```bash
pip install -r requirements.txt
```

Start the Flask application using its configured entry point. For an application defined in `app.py`, this may be:

```bash
python app.py
```

Open the local URL printed by Flask in your browser.

## Applications

- Bitcoin transaction analysis.
- Identification of potentially suspicious transaction patterns.
- Graph-based transaction relationship analysis.
- Machine learning-based transaction classification.
- Big data processing and visualization.

## Future Improvements

- Deploy the dashboard to a cloud platform.
- Improve model evaluation and classification performance.
- Add interactive filters and transaction exploration.
- Integrate external storage for large datasets.
- Optimize Spark jobs for scalable data processing.

## Author

**Amit**

GitHub: [@Amit046](https://github.com/Amit046)

---

*This project is intended for educational and analytical purposes. Model predictions should not be treated as definitive evidence of illicit activity.*
