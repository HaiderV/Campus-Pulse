import test from 'node:test';
import assert from 'node:assert/strict';
import { SentimentModel } from '../backend/sentiment.mjs';

const model = new SentimentModel();

for (const [text, expected] of [
  ['The teachers are excellent and very helpful.', 'positive'],
  ['The food is terrible and the cafeteria is dirty.', 'negative'],
  ['The library is on the second floor.', 'neutral'],
  ['The WiFi is slow and unreliable.', 'negative'],
  ['The library is quiet and a great place to study.', 'positive'],
]) {
  test(`classifies ${expected}: ${text}`, () => {
    const result = model.predict(text);
    assert.equal(result.sentiment, expected);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.ok(Math.abs(Object.values(result.probabilities).reduce((sum, value) => sum + value, 0) - 1) < 0.0001);
  });
}

test('rejects empty feedback', () => assert.throws(() => model.predict('   ')));
test('reports dataset provenance and a held-out evaluation', () => {
  const metadata = model.metadata();
  assert.equal(metadata.training_samples, 90);
  assert.equal(metadata.test_samples, 18);
  assert.ok(metadata.holdout_accuracy >= 0 && metadata.holdout_accuracy <= 1);
  assert.match(metadata.notice, /Demo model/);
});
