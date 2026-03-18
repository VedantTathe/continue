// index.js
// Fixed Lambda function

const fs = require("fs");
const axios = require("axios");

exports.handler = async (event) => {
  console.log("🚀 Lambda invoked");

  try {
    // ✅ FIX 1: Safe JSON.parse with default value
    let config = {};
    try {
      if (process.env.APP_CONFIG) {
        config = JSON.parse(process.env.APP_CONFIG);
      }
    } catch (e) {
      console.warn("Failed to parse APP_CONFIG:", e.message);
    }

    // ✅ FIX 2: Write to /tmp directory (writable in Lambda)
    try {
      fs.writeFileSync("/tmp/startup-log.txt", "Boot successful");
      console.log("Log file written to /tmp");
    } catch (e) {
      console.warn("Failed to write log file:", e.message);
    }

    // ✅ FIX 3: Handle promise rejection properly
    try {
      await axios.get("https://nonexistent-domain-xyz-aws-test.com/data", {
        timeout: 1000, // 1 second timeout
      });
    } catch (e) {
      console.warn("Network request failed (expected):", e.message);
    }

    // ✅ FIX 4: Remove infinite loop - use timeout check instead
    if (process.env.BLOCK === "true") {
      console.log("Block mode enabled - simulating work");
      // Simulate work without infinite loop
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // ✅ FIX 5: Safe JSON.parse on event body
    let data = {};
    try {
      if (event && event.body) {
        data = JSON.parse(event.body);
      }
    } catch (e) {
      console.warn("Failed to parse event body:", e.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Lambda executed successfully",
        config,
        data,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error("Unhandled error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
      }),
    };
  }
};
