import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { Matrix } from 'ml-matrix';
import LogisticRegression from 'ml-logistic-regression';
import TfIdf from 'natural/lib/natural/tfidf/tfidf.js';
import tokenizers from 'natural/lib/natural/tokenizers/regexp_tokenizer.js';

const LABELS = ['positive', 'negative', 'neutral'];
const tokenizer = new tokenizers.WordTokenizer();

function terms(text) {
  const words = tokenizer.tokenize(text.toLowerCase());
  return [...words, ...words.slice(1).map((word, index) => `${words[index]} ${word}`)];
}

function fit(rows) {
  const tfidf = new TfIdf();
  const documents = rows.map(row => terms(row.text));
  documents.forEach(document => tfidf.addDocument(document));
  const vocabulary = [...new Set(documents.flat())];
  const idfs = vocabulary.map(term => tfidf.idf(term));
  function vectorize(text) {
    const frequencies = new Map();
    for (const term of terms(text)) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    const vector = vocabulary.map((term, index) => {
      const count = frequencies.get(term) || 0;
      return count ? (1 + Math.log(count)) * idfs[index] : 0;
    });
    const norm = Math.hypot(...vector) || 1;
    return [...vector.map(value => value / norm), 1];
  }
  const classifier = new LogisticRegression({ numSteps: 400, learningRate: 0.06 });
  classifier.train(
    new Matrix(rows.map(row => vectorize(row.text))),
    Matrix.columnVector(rows.map(row => LABELS.indexOf(row.sentiment))),
  );
  return { classifier, vectorize };
}

export class SentimentModel {
  constructor(trainingPath = new URL('../data/training.csv', import.meta.url)) {
    const rows = parse(readFileSync(trainingPath, 'utf8'), { columns: true, skip_empty_lines: true });
    if (rows.some(row => !row.text?.trim() || !LABELS.includes(row.sentiment)) ||
        LABELS.some(label => rows.filter(row => row.sentiment === label).length < 5)) {
      throw new Error('Training data needs text and sentiment columns, with at least five examples per class.');
    }
    const trainRows = rows.filter((_, index) => index % 5 !== 0);
    const testRows = rows.filter((_, index) => index % 5 === 0);
    const evaluation = fit(trainRows);
    const predicted = evaluation.classifier.predict(new Matrix(testRows.map(row => evaluation.vectorize(row.text))));
    this.holdoutAccuracy = predicted.filter((label, index) => LABELS[label] === testRows[index].sentiment).length / testRows.length;
    this.fitted = fit(rows);
    this.trainingSamples = rows.length;
    this.testSamples = testRows.length;
  }

  predict(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Feedback cannot be empty.');
    const features = new Matrix([this.fitted.vectorize(text)]);
    const scores = this.fitted.classifier.classifiers.map(classifier => 1 - classifier.testScores(features)[0]);
    const total = scores.reduce((sum, score) => sum + score, 0) || 1;
    const probabilities = Object.fromEntries(LABELS.map((label, index) => [label, scores[index] / total]));
    const sentiment = LABELS[scores.indexOf(Math.max(...scores))];
    return { sentiment, confidence: probabilities[sentiment], probabilities };
  }

  metadata() {
    return {
      name: 'TF-IDF + Logistic Regression',
      training_samples: this.trainingSamples,
      test_samples: this.testSamples,
      holdout_accuracy: Math.round(this.holdoutAccuracy * 1000) / 1000,
      dataset: 'Small illustrative English-language college feedback dataset',
      notice: 'Demo model. Predictions may be wrong. Confidence scores are not calibrated probabilities.',
    };
  }
}
