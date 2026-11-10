import os
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
from dotenv import load_dotenv

load_dotenv()

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.getenv("ML_DATA_PATH", os.path.join(BASE_DIR, "data_synthetic.csv"))
MODEL_PATH = os.getenv("MODEL_PATH", os.path.join(BASE_DIR, "model_pipeline.joblib"))

# -------------------------------------------------------------------
# 1. Synthetic dataset generation (only if data file does not exist)
# -------------------------------------------------------------------
if not os.path.exists(DATA_PATH):
    # Seed for reproducibility
    np.random.seed(42)
    n_samples = 1000
    # Numeric features
    skill_score = np.random.randint(1, 11, n_samples)                # 1‑10
    years_experience = np.random.randint(0, 21, n_samples)          # 0‑20 years
    technical_score = np.random.randint(1, 11, n_samples)
    communication_rating = np.random.randint(1, 11, n_samples)
    prev_performance = np.random.randint(1, 11, n_samples)
    # Categorical feature: education
    education_levels = ["highschool", "bachelor", "master", "phd"]
    education = np.random.choice(education_levels, n_samples, p=[0.1, 0.5, 0.3, 0.1])
    # Target (3 classes)
    def assign_target(row):
        score = (row["skill_score"] + row["technical_score"] + row["communication_rating"] + row["prev_performance"]) / 4
        if score >= 8:
            return "Highly Likely to Select"
        elif score >= 5:
            return "Moderately Likely to Select"
        else:
            return "Low Selection Probability"
    df = pd.DataFrame({
        "skill_score": skill_score,
        "years_experience": years_experience,
        "technical_score": technical_score,
        "communication_rating": communication_rating,
        "prev_performance": prev_performance,
        "education": education,
    })
    df["target"] = df.apply(assign_target, axis=1)
    df.to_csv(DATA_PATH, index=False)
    print(f"Synthetic dataset generated at {DATA_PATH}")

# -------------------------------------------------------------------
# 2. Load dataset & preprocessing
# -------------------------------------------------------------------
df = pd.read_csv(DATA_PATH)
X = df.drop(columns=["target"])
y = df["target"]

numeric_features = ["skill_score", "years_experience", "technical_score", "communication_rating", "prev_performance"]
categorical_features = ["education"]

numeric_transformer = Pipeline(
    steps=[("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]
)
categorical_transformer = Pipeline(
    steps=[("imputer", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore"))]
)

preprocess = ColumnTransformer(
    transformers=[
        ("num", numeric_transformer, numeric_features),
        ("cat", categorical_transformer, categorical_features),
    ]
)

# -------------------------------------------------------------------
# 3. Train‑test split (no leakage)
# -------------------------------------------------------------------
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# -------------------------------------------------------------------
# 4. Model pipeline
# -------------------------------------------------------------------
clf = RandomForestClassifier(n_estimators=200, random_state=42, class_weight="balanced")
model_pipeline = Pipeline(steps=[("preprocess", preprocess), ("classifier", clf)])

# -------------------------------------------------------------------
# 5. Train model (if not already saved)
# -------------------------------------------------------------------
if not os.path.exists(MODEL_PATH):
    model_pipeline.fit(X_train, y_train)
    joblib.dump(model_pipeline, MODEL_PATH)
    print(f"Model pipeline trained and saved to {MODEL_PATH}")
else:
    model_pipeline = joblib.load(MODEL_PATH)
    print(f"Loaded model pipeline from {MODEL_PATH}")

# -------------------------------------------------------------------
# 6. Evaluation utilities
# -------------------------------------------------------------------
def evaluate():
    y_pred = model_pipeline.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, average="weighted", zero_division=0)
    rec = recall_score(y_test, y_pred, average="weighted", zero_division=0)
    f1 = f1_score(y_test, y_pred, average="weighted", zero_division=0)
    cm = confusion_matrix(y_test, y_pred, labels=model_pipeline.classes_)
    print("=== Model Evaluation ===")
    print(f"Accuracy: {acc:.3f}")
    print(f"Precision: {prec:.3f}")
    print(f"Recall: {rec:.3f}")
    print(f"F1‑score: {f1:.3f}")
    # Visualize confusion matrix if matplotlib and seaborn are available
    try:
        import matplotlib.pyplot as plt
        import seaborn as sns
        plt.figure(figsize=(6, 4))
        sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", xticklabels=model_pipeline.classes_, yticklabels=model_pipeline.classes_)
        plt.xlabel("Predicted")
        plt.ylabel("Actual")
        plt.title("Confusion Matrix")
        plt.tight_layout()
        plt.savefig("confusion_matrix.png")
        plt.close()
    except ImportError:
        pass
    return {"accuracy": acc, "precision": prec, "recall": rec, "f1": f1}

# Run evaluation when this module is executed directly
if __name__ == "__main__":
    metrics = evaluate()
    print(metrics)

# -------------------------------------------------------------------
# 7. Prediction helper – used by FastAPI endpoint
# -------------------------------------------------------------------
def predict_candidate(features: dict) -> dict:
    """Predict selection class and probabilities.
    ``features`` must contain the same keys as the model expects.
    Returns a dict with ``class`` and ``probabilities`` (mapping class → prob).
    """
    # Convert dict to DataFrame with a single row
    input_df = pd.DataFrame([features])
    probs = model_pipeline.predict_proba(input_df)[0]
    classes = model_pipeline.classes_
    prob_dict = {cls: float(p) for cls, p in zip(classes, probs)}
    pred_class = classes[np.argmax(probs)]
    return {"class": pred_class, "probabilities": prob_dict}
