from factory import Factory, Sequence
from factory.faker import Faker


class UserFactory(Factory):
    class Meta:
        model = dict

    email = Sequence(lambda n: f"user{n}@example.com")
    password = "SecurePass123!"
    full_name = Faker("name")


class AgentFactory(Factory):
    class Meta:
        model = dict

    name = Sequence(lambda n: f"Agent {n}")
    role = Sequence(lambda n: f"role-{n}")
    description = Faker("sentence")
    system_prompt = Faker("paragraph")
    model = "llama-3.3-70b-versatile"
    tools = []
    max_retries = 3


class WorkflowFactory(Factory):
    class Meta:
        model = dict

    name = Sequence(lambda n: f"Workflow {n}")
    description = Faker("sentence")
    nodes = []
    edges = []
    execution_mode = "sequential"
