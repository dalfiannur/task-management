# **Glassmorphism Project: Vibe & Coding Standards**

This document serves as the primary instructions for Claude to maintain the project's unique "Glassmorphism" aesthetic and coding patterns.

## **1\. Visual Identity & Vibe**

* **Vibe:** Premium, modern, translucent, and futuristic.  
* **Core Aesthetic:** Every container should look like frosted glass floating over a vibrant gradient background.  
* **Backgrounds:** Always use high-saturation gradients (e.g., bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500).

## **2\. Tailwind Glassmorphism Tokens**

When building UI, ALWAYS use these class combinations:

### **Glass Containers (Standard)**

* **Light:** bg-white/20 backdrop-blur-xl border border-white/40 shadow-lg  
* **Dark:** dark:bg-black/40 dark:border-white/10 dark:shadow-black/50

### **Glass Surfaces (Subtle/Nested)**

* **Light:** bg-white/10 backdrop-blur-md border border-white/20  
* **Dark:** dark:bg-black/60 dark:border-white/5

### **Buttons**

* **Primary (Solid):** bg-white text-indigo-600 dark:bg-indigo-500 dark:text-white font-bold hover:shadow-lg hover:shadow-white/20  
* **Secondary (Glass):** bg-white/20 dark:bg-white/5 backdrop-blur-md border border-white/30 dark:border-white/10 text-white hover:bg-white/30

### **Inputs & Form Elements**

* **Field:** bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:ring-2 focus:ring-white/30 focus:bg-white/20 outline-none  
* **Dropdowns:** Use the **Glass Containers (Standard)** token for the menu overlay.

### **Typography**

* Use text-white for primary text.  
* Use text-white/70 for secondary/muted text.  
* Use font-bold and tracking-tight for headings.

## **3\. Interactive Component Standards**

All interactive elements MUST include:

* **Transition:** transition-all duration-300  
* **Click Feedback:** active:scale-95  
* **Hover Glow:** hover:shadow-\[0\_0\_20px\_rgba(255,255,255,0.3)\]  
* **Focus:** focus:outline-none focus:ring-2 focus:ring-white/40

## **4\. Coding Patterns**

* **Responsive Design:** Mobile-first. Use sm:, md:, and lg: prefixes.  
* **Dark Mode:** Always implement dark: variants for every glass component.  
* **Icons:** Use thin-line/outline icons (e.g., Lucide React or Heroicons Outline). Avoid solid/filled icons unless necessary.  
* **Animations:** Use subtle entries like animate-in fade-in zoom-in-95 duration-300.

## **5\. Do's and Don'ts for Claude**

* **DON'T** use solid grays (bg-gray-100) or solid whites for backgrounds.  
* **DON'T** use heavy black shadows.  
* **DO** increase backdrop-blur when switching to dark mode.  
* **DO** use rounded-2xl or rounded-3xl for a soft, organic feel.

*Follow these rules strictly to ensure the "Glassmorphism" vibe remains consistent across all new features and components.*