if (!process.env.TEST_VAL) {
  process.exit(1);
} else {
  console.log(JSON.stringify({
    testResults: [{
      name: 'env-test',
      status: 'passed',
      assertionResults: [{ title: process.env.TEST_VAL, status: 'passed' }]
    }]
  }));
}
