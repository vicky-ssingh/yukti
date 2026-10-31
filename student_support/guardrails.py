"""Response guardrails: keep the assistant to student-support topics.

A deterministic pre-check declines clearly off-topic requests before any model call. It is
deliberately conservative: a request that mentions a campus topic always goes to the model,
whose instructions decline anything else that is out of scope.
"""
import re

CAMPUS = re.compile(
    r"\b(fees?|tuition|balance|payments?|pay|portal|scholarships?|merit|award|courses?|programmes?|electives?|"
    r"attendance|exams?|examination|grades?|gpa|semester|term|policy|policies|handbook|tickets?|support|request|approval|"
    r"email|hostel|room|library|deadline|due|late|instalments?|finance|academic|campus|institute|student|record|"
    r"remember|recall|escalat\w*|working days?|holiday|calendar|registration|refund|campus desk|yukti)\b", re.I)

OFF_TOPIC = {
    "coding": re.compile(r"\b(write|create|generate|give|make|build|debug|fix|explain)\b[^.?!]{0,40}\b(program|code|script|function|algorithm|app|website|query|regex)\b"
                         r"|\b(python|java|javascript|typescript|c\+\+|c#|sql|html|css|react|django|flask)\b[^.?!]{0,30}\b(program|code|script|function|loop|class|snippet)\b"
                         r"|\bleetcode\b|\bhello world\b", re.I),
    "entertainment": re.compile(r"\b(movies?|films?|netflix|web ?series|tv shows?|songs?|lyrics|albums?|celebrit\w+|actors?|actress\w*|"
                                r"anime|video games?|ipl|cricket scores?|football scores?|match scores?)\b", re.I),
    "creative writing": re.compile(r"\b(write|compose|create)\b[^.?!]{0,25}\b(poem|story|song|joke|essay|rap|novel|script)\b|\btell (me )?a joke\b", re.I),
    "general knowledge": re.compile(r"\b(recipes?|weather|horoscope|stock (price|market)|crypto\w*|bitcoin|share price|capital of|"
                                    r"who won|world cup|president of|prime minister of)\b", re.I),
}

SUPPORTED = [
    "Fees, balances, due dates and late payment rules",
    "Scholarship status and eligibility",
    "Academic rules: attendance, electives and programme changes",
    "Support tickets: raising, tracking and escalation",
    "Your registered email and remembered preferences",
]
SUGGESTIONS = ["What is my fee balance?", "What is my scholarship status?", "Please create a support ticket"]


def out_of_scope(question):
    """Return the off-topic category for a request with no campus topic, otherwise None."""
    if CAMPUS.search(question):
        return None
    return next((category for category, pattern in OFF_TOPIC.items() if pattern.search(question)), None)


def decline_message(category):
    services = "\n".join(f"- {s}" for s in SUPPORTED)
    return (f"Sorry, I can't help with that. {category.capitalize()} requests are outside what Yukti supports. "
            f"I'm the student support assistant for the institute, and I can help with:\n\n{services}\n\n"
            "Ask me about any of these, or raise a support ticket if you need a person.")
