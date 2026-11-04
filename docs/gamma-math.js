/* Shared Gamma mathematics: same algorithms used by the collective experiment. */
(() => {
  // --- Estatística: Gama, função gama incompleta e experimentos locais ---
  function logGamma(z) {
    const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.6150291621406, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let x = p[0];
    for (let i = 1; i < p.length; i++) x += p[i] / (z + i);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function gammaP(a, x) {
    if (x <= 0) return 0;
    if (x < a + 1) {
      let sum = 1 / a, d = sum;
      for (let n = 1; n <= 300; n++) {
        d *= x / (a + n); sum += d;
        if (Math.abs(d) < Math.abs(sum) * 1e-14) break;
      }
      return Math.max(0, Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a))));
    }
    let b = x + 1 - a, c = 1e30, d = 1 / Math.max(b, 1e-30), h = d;
    for (let i = 1; i <= 300; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-14) break;
    }
    const q = h * Math.exp(-x + a * Math.log(x) - logGamma(a));
    return Math.max(0, Math.min(1, 1 - q));
  }
  function gammaCDF(x, alpha, theta) { return gammaP(alpha, x / theta); }
  function gammaTail(x, alpha, theta) { return 1 - gammaCDF(x, alpha, theta); }
  function gammaQuantile(q, alpha, theta) {
    let hi = Math.max(theta * alpha, theta);
    while (gammaCDF(hi, alpha, theta) < q && hi < 1e9) hi *= 2;
    let lo = 0;
    for (let i = 0; i < 75; i++) {
      const mid = (lo + hi) / 2;
      if (gammaCDF(mid, alpha, theta) < q) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function gammaSample(alpha, theta, rng = Math.random) {
    if (alpha < 1) return gammaSample(alpha + 1, theta, rng) * Math.pow(Math.max(rng(), 1e-15), 1 / alpha);
    const d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
    while (true) {
      const x = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-15))) * Math.cos(2 * Math.PI * rng());
      const v0 = 1 + c * x;
      if (v0 <= 0) continue;
      const v = v0 * v0 * v0, u = Math.max(rng(), 1e-15);
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return theta * d * v;
    }
  }
  function simulateLocal(room, n) {
    const list = [];
    for (let i = 0; i < n; i++) {
      if (room.modo === 'dia') list.push(gammaSample(room.alpha, room.theta));
      else {
        let total = 0;
        for (let day = 0; day < 31; day++) if (Math.random() >= room.seca) total += gammaSample(room.alpha, room.theta);
        list.push(total);
      }
    }
    return list;
  }
  window.GamaMath = { logGamma, gammaP, gammaCDF, gammaTail, gammaQuantile, gammaSample, simulateLocal };

})();

