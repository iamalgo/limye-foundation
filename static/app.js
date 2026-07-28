// Limyè Foundation Website JavaScript

// Mobile menu toggle
document.addEventListener('DOMContentLoaded', function() {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    
    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.addEventListener('click', function() {
            mobileMenu.classList.toggle('hidden');
        });
    }

    // Form handlers
    setupFormHandlers();
    
    // Newsletter subscription
    setupNewsletterSubscription();
    
    // Smooth scrolling for anchor links
    setupSmoothScrolling();
});

// Form submission handlers
function setupFormHandlers() {
    // Housing intake form
    const housingForm = document.getElementById('housing-intake-form');
    if (housingForm) {
        housingForm.addEventListener('submit', handleHousingFormSubmit);
    }

    // Contact form
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', handleContactFormSubmit);
    }
}

// Housing form submission
async function handleHousingFormSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const formData = new FormData(form);
    const submitButton = form.querySelector('button[type="submit"]');
    
    // Get accessibility needs (checkboxes)
    const accessibilityNeeds = Array.from(form.querySelectorAll('input[name="accessibility"]:checked'))
                                   .map(cb => cb.value);
    
    // Prepare form data
    const data = {
        fullName: formData.get('fullName'),
        phone: formData.get('phone'),
        email: formData.get('email'),
        housingNeed: formData.get('housingNeed'),
        moveInDate: formData.get('moveInDate'),
        incomeSource: formData.get('incomeSource'),
        accessibilityNeeds: accessibilityNeeds,
        emergencyName: formData.get('emergencyName'),
        emergencyPhone: formData.get('emergencyPhone'),
        submittedAt: new Date().toISOString()
    };

    // Show loading state
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Submitting...';
    submitButton.disabled = true;

    try {
        const response = await fetch('/api/submit-housing-form', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            showSuccessMessage('Application submitted successfully! We will contact you within 2 business days.');
            form.reset();
        } else {
            showErrorMessage(result.message || 'There was an error submitting your application. Please try again.');
        }
    } catch (error) {
        console.error('Form submission error:', error);
        showErrorMessage('There was an error submitting your application. Please try again or contact us directly.');
    } finally {
        submitButton.textContent = originalText;
        submitButton.disabled = false;
    }
}

// Contact form submission
async function handleContactFormSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const formData = new FormData(form);
    const submitButton = form.querySelector('button[type="submit"]');
    
    const data = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        interest: formData.get('interest'),
        message: formData.get('message'),
        submittedAt: new Date().toISOString()
    };

    // Show loading state
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Sending...';
    submitButton.disabled = true;

    try {
        const response = await fetch('/api/submit-contact-form', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            showSuccessMessage('Message sent successfully! We will respond within 1 business day.');
            form.reset();
        } else {
            showErrorMessage(result.message || 'There was an error sending your message. Please try again.');
        }
    } catch (error) {
        console.error('Contact form submission error:', error);
        showErrorMessage('There was an error sending your message. Please try again or contact us directly.');
    } finally {
        submitButton.textContent = originalText;
        submitButton.disabled = false;
    }
}

// Newsletter subscription
function setupNewsletterSubscription() {
    const newsletterButtons = document.querySelectorAll('button');
    
    newsletterButtons.forEach(button => {
        if (button.textContent.includes('Subscribe') || button.textContent.includes('Sign Up')) {
            button.addEventListener('click', handleNewsletterSubscription);
        }
    });
}

async function handleNewsletterSubscription(e) {
    const emailInput = e.target.parentElement.querySelector('input[type="email"]');
    if (!emailInput) return;
    
    e.preventDefault();
    
    const email = emailInput.value.trim();
    if (!email) {
        showErrorMessage('Please enter a valid email address.');
        return;
    }

    const originalText = e.target.textContent;
    e.target.textContent = 'Subscribing...';
    e.target.disabled = true;

    try {
        const response = await fetch('/api/subscribe-newsletter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email })
        });

        const result = await response.json();

        if (result.success) {
            showSuccessMessage('Successfully subscribed to our newsletter!');
            emailInput.value = '';
        } else {
            showErrorMessage(result.message || 'There was an error with your subscription. Please try again.');
        }
    } catch (error) {
        console.error('Newsletter subscription error:', error);
        showErrorMessage('There was an error with your subscription. Please try again.');
    } finally {
        e.target.textContent = originalText;
        e.target.disabled = false;
    }
}

// Success/Error message display
function showSuccessMessage(message) {
    showNotification(message, 'success');
}

function showErrorMessage(message) {
    showNotification(message, 'error');
}

function showNotification(message, type) {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(n => n.remove());

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-md ${
        type === 'success' 
            ? 'bg-green-500 text-white' 
            : 'bg-red-500 text-white'
    }`;
    
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'} mr-2"></i>
            <span>${message}</span>
            <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Smooth scrolling for anchor links
function setupSmoothScrolling() {
    const links = document.querySelectorAll('a[href^="#"]');
    
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                e.preventDefault();
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Form validation helpers
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePhone(phone) {
    const re = /^[\+]?[1-9][\d]{0,15}$/;
    return re.test(phone.replace(/[\s\-\(\)]/g, ''));
}

// Utility functions for form handling
function formatPhoneNumber(phone) {
    // Remove all non-digits
    const cleaned = phone.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX for US numbers
    if (cleaned.length === 10) {
        return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned[0] === '1') {
        return `+1 (${cleaned.slice(1,4)}) ${cleaned.slice(4,7)}-${cleaned.slice(7)}`;
    }
    
    return phone; // Return original if doesn't match expected format
}

// Analytics tracking (placeholder for future implementation)
function trackEvent(eventName, properties = {}) {
    // Placeholder for analytics tracking
    console.log('Event tracked:', eventName, properties);
    
    // Future: Implement Google Analytics, Mixpanel, or other tracking
    if (typeof gtag !== 'undefined') {
        gtag('event', eventName, properties);
    }
}

// Track form submissions
function trackFormSubmission(formType, success) {
    trackEvent('form_submission', {
        form_type: formType,
        success: success,
        timestamp: new Date().toISOString()
    });
}

// Page load analytics
document.addEventListener('DOMContentLoaded', function() {
    trackEvent('page_view', {
        page: window.location.pathname,
        title: document.title,
        timestamp: new Date().toISOString()
    });
});

// Accessibility improvements
document.addEventListener('keydown', function(e) {
    // ESC key to close mobile menu
    if (e.key === 'Escape') {
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
            mobileMenu.classList.add('hidden');
        }
        
        // Close notifications
        const notifications = document.querySelectorAll('.notification');
        notifications.forEach(n => n.remove());
    }
});

// Print-friendly styles
function setupPrintStyles() {
    const printButton = document.createElement('button');
    printButton.innerHTML = '<i class="fas fa-print mr-2"></i>Print Page';
    printButton.className = 'fixed bottom-4 right-4 bg-gray-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-gray-700 print:hidden';
    printButton.onclick = () => window.print();
    
    // Only add print button on content pages
    if (window.location.pathname !== '/') {
        document.body.appendChild(printButton);
    }
}

// Initialize print functionality
document.addEventListener('DOMContentLoaded', setupPrintStyles);