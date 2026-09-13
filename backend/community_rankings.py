"""Public rankings: consent gates are evaluated on every request, never cached."""
from datetime import timedelta


async def build_rankings(db, timestamp):
    public = {"is_public": True, "status": "active"}
    community_pipeline = [
        {"$match": public},
        {"$lookup": {
            "from": "community_members", "let": {"community": "$id"},
            "pipeline": [
                {"$match": {"$expr": {"$eq": ["$community_id", "$$community"]}, "status": "active"}},
                {"$count": "count"},
            ], "as": "members",
        }},
        {"$set": {"member_count": {"$ifNull": [{"$arrayElemAt": ["$members.count", 0]}, 0]}}},
        {"$lookup": {"from": "users", "localField": "owner_id", "foreignField": "id", "as": "owners"}},
        {"$project": {"_id": 0, "id": 1, "name": 1, "owner_id": 1, "member_count": 1,
                        "owners.id": 1, "owners.full_name": 1, "owners.avatar_url": 1}},
        {"$sort": {"member_count": -1, "id": 1}},
    ]
    # Include all public communities before grouping coaches or selecting the top ten.
    communities = [row async for row in db.communities.aggregate(community_pipeline)]
    coaches = {}
    for community in communities:
        owners = community.pop("owners", [])
        owner = owners[0] if owners else None
        row = coaches.setdefault(community["owner_id"], {
            "coach": owner, "community_count": 0, "member_count": 0,
        })
        row["community_count"] += 1
        row["member_count"] += community["member_count"]

    since = timestamp - timedelta(days=30)
    pipeline = [
        {"$match": {"status": "active", "created_at": {"$gte": since, "$lte": timestamp}}},
        {"$lookup": {"from": "channels", "localField": "channel_id", "foreignField": "id", "as": "channel"}},
        {"$unwind": "$channel"},
        {"$match": {"channel.status": "active", "channel.ranking_opt_in": True}},
        {"$lookup": {"from": "communities", "localField": "channel.community_id", "foreignField": "id", "as": "community"}},
        {"$unwind": "$community"},
        {"$match": {"community.status": "active", "community.is_public": True}},
        {"$lookup": {"from": "users", "localField": "author_id", "foreignField": "id", "as": "author"}},
        {"$unwind": "$author"},
        {"$match": {"author.activity_ranking_opt_in": True}},
        {"$lookup": {
            "from": "community_members", "let": {"community": "$channel.community_id", "author": "$author_id"},
            "pipeline": [{"$match": {"status": "active", "$expr": {"$and": [
                {"$eq": ["$community_id", "$$community"]}, {"$eq": ["$user_id", "$$author"]},
            ]}}}], "as": "membership",
        }},
        {"$match": {"membership.0": {"$exists": True}}},
        {"$set": {"day": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at", "timezone": "UTC"}}}},
        {"$facet": {
            "users": [
                {"$group": {"_id": "$author_id", "days": {"$addToSet": "$day"},
                             "full_name": {"$first": "$author.full_name"}, "avatar_url": {"$first": "$author.avatar_url"}}},
                {"$project": {"_id": 0, "id": "$_id", "full_name": 1, "avatar_url": 1, "active_days": {"$size": "$days"}}},
                {"$sort": {"active_days": -1, "id": 1}}, {"$limit": 10},
            ],
            "channels": [
                {"$group": {"_id": "$channel_id", "contributors": {"$addToSet": "$author_id"},
                             "name": {"$first": "$channel.name"}, "community_id": {"$first": "$community.id"},
                             "community_name": {"$first": "$community.name"}}},
                {"$project": {"_id": 0, "id": "$_id", "name": 1, "community_id": 1, "community_name": 1,
                               "contributors": {"$size": "$contributors"}}},
                {"$sort": {"contributors": -1, "id": 1}}, {"$limit": 10},
            ],
        }},
    ]
    activity = [row async for row in db.messages.aggregate(pipeline)]
    result = activity[0] if activity else {"users": [], "channels": []}
    return {
        "communities": communities[:10],
        "coaches": sorted(coaches.values(), key=lambda row: (-row["member_count"], (row["coach"] or {}).get("id", "")))[:10],
        **result, "window_days": 30,
    }