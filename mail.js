

function sendEmail(to, subject, body) {
    // This is a placeholder function. In a real application, you would use a library
    // like nodemailer to send emails.
    console.log(`Sending email to: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);
}

module.exports = {
    sendEmail
};