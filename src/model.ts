import * as tf from '@tensorflow/tfjs';

let model: tf.LayersModel | null = null;
let scaler: any = null;

/**
 * Load the TensorFlow.js model and scaler
 */
export async function loadModel() {
  if (!model) {
    try {
      // Load the pre-trained model
      model = await tf.loadLayersModel('https://lizgo99.github.io/my-tfjs-model/old_model/model.json');
      // model = await tf.loadLayersModel('model/model.json');
      
      // Load the scaler parameters
      const response = await fetch('https://lizgo99.github.io/my-tfjs-model/old_model/scaler.json');
      // const response = await fetch('model/scaler.json');
      scaler = await response.json();
      
      console.log('Model and scaler loaded successfully');
    } catch (error) {
      console.error('Error loading the model:', error);
      throw error;
    }
  }
  return model;
}

/**
 * Scale features using the saved scaler parameters
 */
function scaleFeatures(features: number[]): number[] {
  if (!scaler) {
    throw new Error('Scaler not loaded');
  }
  
  return features.map((value, index) => {
    return (value - scaler.mean[index]) / scaler.scale[index];
  });
}

interface URLFeatures {
  url: string;
  hostname: string;
  path: string;
  title?: string;
  hyperlinks?: string[];
}

// Feature descriptions for the ML model
export const featureDescriptions: { [key: string]: string } = {
  length_url: "URL length",
  length_hostname: "Domain name length",
  ip: "IP address used instead of domain name",
  nb_dots: "Number of dots in URL",
  nb_qm: "Number of question marks",
  nb_eq: "Number of equal signs",
  nb_slash: "Number of forward slashes",
  nb_www: "Number of 'www' substrings",
  ratio_digits_url: "Ratio of digits in URL",
  ratio_digits_host: "Ratio of digits in hostname",
  tld_in_subdomain: "TLD appears in subdomain",
  prefix_suffix: "Presence of prefix/suffix separator (-)",
  shortest_word_host: "Length of shortest word in hostname",
  longest_words_raw: "Length of longest word in URL",
  longest_word_path: "Length of longest word in path",
  phish_hints: "Number of phishing-related keywords",
  nb_hyperlinks: "Number of hyperlinks",
  ratio_intHyperlinks: "Ratio of internal hyperlinks",
  empty_title: "Empty or missing page title",
  domain_in_title: "Domain name present in page title"
};

/**
 * Extract features from a URL and related information for phishing detection
 * @param urlData - Object containing URL and related information
 * @returns Array of numerical features
 */
export function extractFeatures(urlData: URLFeatures): number[] {
  const { url, hostname, path, title = '', hyperlinks = [] } = urlData;

  // Length-based features
  const length_url = url.length;
  const length_hostname = hostname.length;

  // IP-based feature
  const ip = hostname.split('.').every(part => !isNaN(Number(part))) ? 1 : 0;

  // Character counting features
  const nb_dots = (url.match(/\./g) || []).length;
  const nb_qm = (url.match(/\?/g) || []).length;
  const nb_eq = (url.match(/=/g) || []).length;
  const nb_slash = (url.match(/\//g) || []).length;
  const nb_www = (url.match(/www\./g) || []).length;

  // Ratio calculations
  const digits_url = (url.match(/\d/g) || []).length;
  const ratio_digits_url = digits_url / url.length;
  
  const digits_host = (hostname.match(/\d/g) || []).length;
  const ratio_digits_host = digits_host / hostname.length;

  // TLD and domain analysis
  const tld = hostname.split('.').slice(-1)[0];
  const subdomains = hostname.split('.').slice(0, -2);
  const tld_in_subdomain = subdomains.some(sub => sub.toLowerCase() === tld.toLowerCase()) ? 1 : 0;

  // Prefix/Suffix check
  const prefix_suffix = hostname.includes('-') ? 1 : 0;

  // Word length analysis
  const host_words = hostname.split(/[.-]/);
  const shortest_word_host = Math.min(...host_words.map(w => w.length));
  const longest_words_raw = Math.max(...url.split(/[/?=&.-]/).map(w => w.length));
  const longest_word_path = Math.max(...path.split(/[/?=&.-]/).map(w => w.length));

  // Phishing hints
  const phishingKeywords = ['secure', 'account', 'webscr', 'login', 'ebayisapi', 'signin', 'banking', 'confirm'];
  const phish_hints = phishingKeywords.reduce((count, keyword) => 
    count + (url.toLowerCase().includes(keyword) ? 1 : 0), 0);

  // Hyperlink analysis
  const nb_hyperlinks = hyperlinks.length;
  const internalLinks = hyperlinks.filter(link => link.includes(hostname));
  const ratio_intHyperlinks = nb_hyperlinks > 0 ? internalLinks.length / nb_hyperlinks : 0;

  // Title analysis
  const empty_title = title.trim().length === 0 ? 1 : 0;
  const domain_in_title = title.toLowerCase().includes(hostname.toLowerCase()) ? 1 : 0;

  return [
    length_url,
    length_hostname,
    ip,
    nb_dots,
    nb_qm,
    nb_eq,
    nb_slash,
    nb_www,
    ratio_digits_url,
    ratio_digits_host,
    tld_in_subdomain,
    prefix_suffix,
    shortest_word_host,
    longest_words_raw,
    longest_word_path,
    phish_hints,
    nb_hyperlinks,
    ratio_intHyperlinks,
    empty_title,
    domain_in_title
  ];
}

/**
 * Get features that have significant values
 * @param features - Array of feature values
 * @returns Object mapping feature names to their values for significant features
 */
export function getSignificantFeatures(features: number[]): { [key: string]: number } {
  const featureNames = [
    'length_url', 'length_hostname', 'ip', 'nb_dots', 'nb_qm', 'nb_eq', 'nb_slash',
    'nb_www', 'ratio_digits_url', 'ratio_digits_host', 'tld_in_subdomain',
    'prefix_suffix', 'shortest_word_host', 'longest_words_raw', 'longest_word_path',
    'phish_hints', 'nb_hyperlinks', 'ratio_intHyperlinks', 'empty_title', 'domain_in_title'
  ];

  const significantFeatures: { [key: string]: number } = {};
  features.forEach((value, index) => {
    // For binary features (0/1), include if 1
    // For ratio features, include if > 0.3
    // For count features, include if > 0
    const featureName = featureNames[index];
    if (
      (featureName.startsWith('ratio_') && value > 0.3) ||
      (featureName === 'ip' && value === 1) ||
      (featureName === 'tld_in_subdomain' && value === 1) ||
      (featureName === 'prefix_suffix' && value === 1) ||
      (featureName === 'empty_title' && value === 1) ||
      (featureName === 'domain_in_title' && value === 0) || // Note: absence is suspicious
      (value > 0 && !featureName.startsWith('ratio_') && 
       !['ip', 'tld_in_subdomain', 'prefix_suffix', 'empty_title', 'domain_in_title'].includes(featureName))
    ) {
      significantFeatures[featureName] = value;
    }
  });
  
  return significantFeatures;
}

/**
 * Predict the risk score using the model
 */
export async function predict(features: number[]): Promise<number> {
  try {
    if (!model) {
      await loadModel();
    }
    
    if (!model) {
      throw new Error('Model failed to load');
    }
    
    // Ensure we have exactly 20 features
    if (features.length !== 20) {
      throw new Error(`Expected 20 features, but got ${features.length}`);
    }

    return tf.tidy(() => {
      try {
        // Scale the features
        const scaledFeatures = scaleFeatures(features);
        
        // Create input tensor with explicit shape
        const inputTensor = tf.tensor2d(scaledFeatures, [1, 20]);
        
        // Make prediction
        const prediction = model!.predict(inputTensor) as tf.Tensor;
        
        // Get the prediction value
        const result = prediction.dataSync()[0];
        
        // Clean up tensors
        inputTensor.dispose();
        prediction.dispose();
        
        return result;
      } catch (error) {
        console.error('Error during prediction:', error);
        throw error;
      }
    });
  } catch (error) {
    console.error('Prediction error:', error);
    throw error;
  }
}