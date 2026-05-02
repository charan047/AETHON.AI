from typing import Any, List, Optional, TypedDict


class InputVariable(TypedDict):
    name: str
    label: str
    type: str
    required: bool
    placeholder: Optional[str]
    options: Optional[List[str]]
    default: Optional[Any]


class AgentConfig(TypedDict):
    name: str
    system_prompt: str
    model: str
    tools: List[str]
    max_iterations: int
    temperature: float
    role_slug: str
    seniority_level: int
    autonomy_level: str
    initial_trust_score: float


class WorkflowConfig(TypedDict):
    name: str
    description: str
    trigger_type: str
    schedule: Optional[str]
    input_template: str
    input_variables: List[InputVariable]


class ListingConfig(TypedDict):
    name: str
    slug: str
    description: str
    short_description: str
    category: str
    tags: List[str]
    icon: str
    required_tools: List[str]
    optional_tools: List[str]
    required_integrations: List[str]
    recommended_integrations: List[str]
    estimated_minutes_saved_per_week: int
    difficulty: str
    version: str
    is_featured: bool
    role_slug: str
    department_type: str
    hiring_tagline: str


class MarketplaceTemplate(TypedDict):
    listing: ListingConfig
    agent: AgentConfig
    workflow: WorkflowConfig
